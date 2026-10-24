#!/usr/bin/env python3
"""Independent scalar fundamental oracle and extraction of stored development fixtures.
Uses existing NumPy; no simulator imports, RF reconstruction, GPU or installation.
"""
from pathlib import Path
import argparse, hashlib, json, math, platform, sys, time
import numpy as np

ROOT = Path(__file__).resolve().parent
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
SQRT2 = math.sqrt(2.0)
FWHM_FACTOR = 2.0 * math.sqrt(2.0 * math.log(2.0))
DB_TO_NP = math.log(10.0) / 20.0


def parameters(spec):
    mu = spec["source"]["muMHz"]
    s0 = spec["source"]["fractionalHalfAmplitudeBandwidth"] * mu / FWHM_FACTOR
    so = spec["units"]["soundSpeedMmUs"] / (4 * math.pi * spec["source"]["axialSigmaAtFaceMm"])
    vr = 1 / (1 / so**2 - 1 / s0**2)
    if not vr > 0:
        raise ValueError("Receiver variance must be positive")
    return s0**2, vr


def analytic(case, spec):
    """Complete the quadratic independently of pointwise spectrum generation."""
    v0, vr = parameters(spec)
    mu0 = case.get("sourceMuMHz", spec["source"]["muMHz"])
    mu_r = spec["source"]["muMHz"]
    if case["receiver"] == "narrow":
        vr /= 4
    beta_total = sum(
        spec["slopes"][layer["material"]] * layer["lengthMm"] / 10
        for layer in case["layers"]
    ) * case["passes"] * DB_TO_NP
    inv_v = 1 / v0
    linear = mu0 / v0 - beta_total
    constant = -mu0**2 / (2 * v0) - DB_TO_NP * case.get("fixedAmplitudeLossDb", 0)
    if case["receiver"] != "none":
        inv_v += 1 / vr
        linear += mu_r / vr
        constant -= mu_r**2 / (2 * vr)
    v = 1 / inv_v
    mu = linear * v
    peak = math.exp(constant + mu * mu / (2 * v))
    return dict(muMHz=mu, varianceMHz2=v, peakAmplitude=peak, betaTotalPerMHz=beta_total)


def spectrum(f, case, spec):
    """Literal pointwise source × each layer traversal × receiver.
    This does not use analytic() or its accumulated slope/product parameters.
    """
    v0, vr = parameters(spec)
    mu0 = case.get("sourceMuMHz", spec["source"]["muMHz"])
    source = np.exp(-0.5 * (f - mu0)**2 / v0)
    path = np.ones_like(f)
    for _ in range(case["passes"]):
        for layer in case["layers"]:
            loss_db = spec["slopes"][layer["material"]] * (layer["lengthMm"] / 10) * f
            path *= np.power(10.0, -loss_db / 20.0)
    fixed = 10.0**(-case.get("fixedAmplitudeLossDb", 0) / 20.0)
    if case["receiver"] == "narrow":
        vr /= 4
    receiver = np.ones_like(f) if case["receiver"] == "none" else np.exp(
        -0.5 * (f - spec["source"]["muMHz"])**2 / vr
    )
    # Unit white analytic noise is introduced AFTER patient and echo formation.
    return source * path * fixed * receiver, receiver**2


def truncated_gaussian(mu, variance, peak, upper):
    sigma = math.sqrt(variance)
    a, b = -mu / sigma, (upper - mu) / sigma
    phi = lambda x: math.exp(-x*x/2) / math.sqrt(2*math.pi)
    mass = 0.5 * (math.erfc(a/SQRT2) - math.erfc(b/SQRT2))
    ratio = (phi(a) - phi(b)) / mass
    return dict(
        integral=peak*sigma*math.sqrt(2*math.pi)*mass,
        meanMHz=mu+sigma*ratio,
        varianceMHz2=variance*(1+(a*phi(a)-b*phi(b))/mass-ratio*ratio),
        omittedWholeAxisMassFraction=1-mass,
    )


def moments(f, values):
    integral = np.trapezoid(values, f)
    mean = np.trapezoid(f*values, f) / integral
    variance = np.trapezoid((f-mean)**2*values, f) / integral
    return dict(integral=float(integral), meanMHz=float(mean), varianceMHz2=float(variance))


def crossing(f, y):
    """Half sampled amplitude, adjacent-cell bracket, no fit/smoothing."""
    j = int(np.argmax(y))
    half = y[j] / 2
    left = next((i for i in range(j-1, -1, -1) if y[i] <= half), None)
    right = next((i for i in range(j+1, len(y)) if y[i] <= half), None)
    if left is None or right is None:
        return dict(status="missing-left" if left is None else "missing-right", sampledPeakIndex=j)
    interp = lambda a, b: float(f[a] + (half-y[a])*(f[b]-f[a])/(y[b]-y[a]))
    lo, hi = interp(left, left+1), interp(right-1, right)
    return dict(status="measured", width=hi-lo,
                widthCellInterval=[float(f[right-1]-f[left+1]), float(f[right]-f[left])])


def direct_inverse(f, y, t):
    return complex(np.trapezoid(y*np.exp(2j*np.pi*f*t), f))


def direct_half_width(f, y, spec):
    peak = abs(direct_inverse(f, y, 0))
    lo, hi = spec["timing"]["rootBracketUs"]
    if abs(direct_inverse(f, y, lo)) < peak/2 or abs(direct_inverse(f, y, hi)) > peak/2:
        raise ValueError("Direct inverse half-amplitude root not bracketed")
    for _ in range(spec["timing"]["rootIterations"]):
        mid = (lo+hi)/2
        if abs(direct_inverse(f, y, mid)) > peak/2:
            lo = mid
        else:
            hi = mid
    return (lo+hi), [2*lo, 2*hi]  # symmetric full width, in us


def evaluate(case, grid, spec):
    df, nfft = grid["stepMHz"], grid["nfft"]
    f = np.arange(round(grid["maxMHz"]/df)+1, dtype=np.float64)*df
    y, noise_psd = spectrum(f, case, spec)
    p = analytic(case, spec)
    expected_amp = truncated_gaussian(p["muMHz"], p["varianceMHz2"], p["peakAmplitude"], f[-1])
    expected_power = truncated_gaussian(p["muMHz"], p["varianceMHz2"]/2, p["peakAmplitude"]**2, f[-1])
    amplitude, power = moments(f, y), moments(f, y*y)
    _, vr = parameters(spec)
    if case["receiver"] == "narrow":
        vr /= 4
    noise_reference = dict(integral=float(f[-1]), meanMHz=float(f[-1]/2), varianceMHz2=float(f[-1]**2/12)) if case["receiver"] == "none" else truncated_gaussian(spec["source"]["muMHz"], vr/2, 1, f[-1])

    coeff = np.zeros(nfft, dtype=np.complex128)
    coeff[:len(y)] = y
    coeff[0] *= 0.5
    coeff[len(y)-1] *= 0.5  # trapezoid endpoints on the SAME positive-frequency support
    impulse = np.fft.ifft(coeff) * (nfft*df)
    dt = 1 / (nfft*df)
    half_window = round(spec["timing"]["retainedWindowUs"]/dt)
    indices = np.arange(-half_window, half_window+1)
    times = indices*dt
    pulse = impulse[indices % nfft]
    direct = [direct_inverse(f, y, t) for t in spec["timing"]["directTimesUs"]]
    fft_at = [impulse[round(t/dt) % nfft] for t in spec["timing"]["directTimesUs"]]
    scale = abs(direct_inverse(f, y, 0))
    inverse_error = max(abs(a-b)/scale for a,b in zip(direct,fft_at))
    direct_width, root_interval = direct_half_width(f, y, spec)
    sampled_width = crossing(times, np.abs(pulse))
    theoretical_sigma_z = spec["units"]["soundSpeedMmUs"] / (4*math.pi*math.sqrt(p["varianceMHz2"]))
    # Absolute bound for removing f<0 and f>F from the full-axis inverse:
    # |delta h(t)| <= integral of the omitted nonnegative amplitude spectrum.
    omitted = expected_amp["omittedWholeAxisMassFraction"]
    analytic_error = 0.0
    quadrature_bound = 0.0
    full_peak = p["peakAmplitude"]*math.sqrt(2*math.pi*p["varianceMHz2"])
    for t, actual in zip(spec["timing"]["directTimesUs"], direct):
        full = full_peak*np.exp(-2*math.pi**2*p["varianceMHz2"]*t*t + 2j*math.pi*p["muMHz"]*t)
        analytic_error = max(analytic_error, abs(actual-full)/full_peak)
        sigma = math.sqrt(p["varianceMHz2"])
        omega = abs(2*math.pi*t)
        # Composite-trapezoid bound from max |(S exp(i omega f))''|:
        # |S''|<=A/v, |S'|<=A/(sigma sqrt(e)), |S|<=A.
        bound = f[-1]*df*df/12*(1/sigma**2+2*omega/(sigma*math.sqrt(math.e))+omega**2)/(sigma*math.sqrt(2*math.pi))
        quadrature_bound = max(quadrature_bound, bound)
    result = dict(
        case=case["id"], grid=grid, gaussianWholeAxisParameters=p,
        amplitudeMoments=amplitude, powerMoments=power,
        exactPositiveSupportAmplitudeMoments=expected_amp, exactPositiveSupportPowerMoments=expected_power,
        amplitudeBandFwhmMHz=crossing(f,y),
        directInverse=[[t,z.real,z.imag] for t,z in zip(spec["timing"]["directTimesUs"],direct)],
        directIfftMaxRelativeError=float(inverse_error),
        wholeAxisInverseMaxRelativeError=float(analytic_error),
        wholeAxisInverseOmissionBound=omitted,
        conservativeInverseQuadratureRelativeBound=quadrature_bound,
        directEnvelopeFwhmUs=direct_width, directRootIntervalUs=root_interval,
        fftEnvelopeFwhmUs=sampled_width,
        directEnvelopeFwhmMm=direct_width*spec["units"]["soundSpeedMmUs"]/2,
        gaussianWholeAxisSigmaZMm=theoretical_sigma_z,
        receiverNoiseMoments=moments(f,noise_psd),
        exactReceiverNoiseMoments=noise_reference,
        receiverNoiseBandlimitedPower=float(np.trapezoid(noise_psd,f)),
    )
    arrays=dict(frequencyMHz=f, amplitudeSpectrum=y, receiverNoisePsd=noise_psd,
                timeUs=times, impulse=pulse)
    return result, arrays


def extract_fixture(directory, output):
    """Read existing arrays; do not reacquire or synthesize fixture samples.

    Hashes establish file integrity, not physical origin. Summaries are checked
    against stored NPZ arrays; the CI fixture is explicitly development evidence.
    """
    directory = directory.resolve()
    report_bytes = (directory/"report.json").read_bytes()
    report = json.loads(report_bytes)
    spec_path = directory/"executed-spec.json"
    script_path = directory/"executed-script.py"
    raw_path = directory/"profiles.npz"
    if report["status"] != "passed" or not report["sourceUnchanged"]:
        raise ValueError("Cannot export a failed or changed-source acquisition")
    if report["protocolId"] != "b4-fundamental-spectral-oracle-v2":
        raise ValueError("Unsupported spectral reference protocol")
    for path, key in [(spec_path,"specSha256"),(script_path,"scriptSha256"),(raw_path,"profilesSha256")]:
        if sha(path) != report[key]:
            raise ValueError("Original hash differs: " + path.name)
    spec = json.loads(spec_path.read_bytes())
    expected = {(case["id"],grid["id"]) for case in spec["cases"] for grid in spec["grids"]}
    rows = {(row["case"],row["grid"]["id"]):row for row in report["results"]}
    if len(rows) != len(report["results"]) or set(rows) != expected:
        raise ValueError("Incomplete or duplicate case/grid inventory")
    if len(report["checks"]) != 378 or not all(check["passed"] for check in report["checks"]):
        raise ValueError("Incomplete or failed declared checks")
    selected = {"face", "liver-100", "fluid-100", "narrow-receiver"}
    measurements, profiles = [], []
    with np.load(raw_path, allow_pickle=False) as arrays:
        for case in spec["cases"]:
            row = rows[(case["id"], "refined")]
            prefix = case["id"].replace("-", "_") + "__refined__"
            f, amplitude, noise, times, impulse = [arrays[prefix+key] for key in
                ["frequencyMHz", "amplitudeSpectrum", "receiverNoisePsd", "timeUs", "impulse"]]
            for array in [f, amplitude, noise, times, impulse]:
                if array.ndim != 1 or not np.all(np.isfinite(array)):
                    raise ValueError("Invalid raw profile")
            if len(f) != len(amplitude) or len(f) != len(noise) or len(times) != len(impulse):
                raise ValueError("Raw coordinate length differs")
            if not np.all(np.diff(f)>0) or not np.all(np.diff(times)>0) or np.any(amplitude<0) or np.any(noise<0):
                raise ValueError("Invalid profile coordinates or spectrum")
            # Exact recomputation of stored-array summaries, without Fourier inversion.
            amp_moments, power_moments, noise_moments = moments(f, amplitude), moments(f, amplitude*amplitude), moments(f, noise)
            for actual, name in [(amp_moments,"amplitudeMoments"),(power_moments,"powerMoments"),(noise_moments,"receiverNoiseMoments")]:
                if actual != row[name]:
                    raise ValueError("Report moments differ from raw arrays: " + case["id"])
            full_width = crossing(times, np.abs(impulse))
            if full_width != row["fftEnvelopeFwhmUs"] or full_width["status"] != "measured":
                raise ValueError("Report envelope differs from raw arrays: " + case["id"])
            zscale = spec["units"]["soundSpeedMmUs"] / 2
            measurements.append(dict(id=case["id"], amplitudeMoments=amp_moments, powerMoments=power_moments,
                receiverNoiseMoments=noise_moments, fftEnvelopeFwhmMm=full_width["width"]*zscale,
                fftEnvelopeCellIntervalMm=[x*zscale for x in full_width["widthCellInterval"]],
                frequencyHalfAmplitudeBand=crossing(f,amplitude)))
            if case["id"] in selected:
                # Existing dyadic grid positions only; no interpolation, scaling or normalization.
                indices = np.flatnonzero((times>=-1) & (times<=1) & (times*64==np.rint(times*64)))
                if len(indices)!=129:
                    raise ValueError("Expected 129 original time samples")
                sampled = crossing(times[indices], np.abs(impulse[indices]))
                profiles.append(dict(id=case["id"], rawTimeKey=prefix+"timeUs", rawImpulseKey=prefix+"impulse",
                    rawIndices=indices.tolist(), samples=[[float(times[i]),float(impulse[i].real),float(impulse[i].imag)] for i in indices],
                    sampledEnvelopeFwhmMm=sampled["width"]*zscale,
                    sampledEnvelopeCellIntervalMm=[x*zscale for x in sampled["widthCellInterval"]]))
    fixture = dict(schemaVersion=1, protocolId=report["protocolId"], origin="synthetic", evidenceRole="development",
        calibration="pending", humanValidation="pending", units=spec["units"], source=spec["source"],
        slopes=spec["slopes"], cases=spec["cases"], grid=next(g for g in spec["grids"] if g["id"]=="refined"),
        provenance=dict(reportSha256=hashlib.sha256(report_bytes).hexdigest(), specSha256=report["specSha256"],
            generatorSha256=report["scriptSha256"], profilesSha256=report["profilesSha256"],
            extractorSha256=sha(__file__), python=report["python"], numpy=report["numpy"],
            summariesRecomputedFromRaw=True, profileOperation="select exact stored indices; no normalization or synthesis"),
        counterfactuals=[c for c in report["checks"] if c["name"].startswith("negative/")],
        measurements=measurements, profiles=profiles)
    with output.open("x") as file:
        file.write(json.dumps(fixture,indent=2,allow_nan=False)+"\n")
    print(json.dumps(dict(scope="stored-result-extraction-only", cases=len(measurements), profiles=len(profiles),
                         samplesPerProfile=129, output=str(output), sha256=sha(output))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", type=Path, default=ROOT/"fundamentalSpectrum.spec.json")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--extract-fixture", type=Path)
    args = ap.parse_args()
    if args.extract_fixture is not None:
        extract_fixture(args.extract_fixture, args.out)
        return
    raw = args.spec.read_bytes()
    spec = json.loads(raw)
    spec_hash, script_hash = hashlib.sha256(raw).hexdigest(), sha(__file__)
    args.out.mkdir(parents=False, exist_ok=False)
    start = time.perf_counter()
    rows, arrays, checks = [], {}, []
    def check(name, ok, detail=None):
        checks.append(dict(name=name, passed=bool(ok), detail=detail))
    # The plan is sealed before calculation; output is an exclusive new directory.
    (args.out/"executed-spec.json").write_bytes(raw)
    (args.out/"executed-script.py").write_bytes(Path(__file__).read_bytes())
    for case in spec["cases"]:
        for grid in spec["grids"]:
            row, data = evaluate(case,grid,spec)
            rows.append(row)
            prefix = case["id"].replace("-","_")+"__"+grid["id"]+"__"
            arrays.update({prefix+k:v for k,v in data.items()})
            tol = spec["acceptance"]["dcStressMomentAbsoluteTolerance"] if case["id"]=="positive-support-stress" else spec["acceptance"]["ordinaryMomentAbsoluteTolerance"]
            for kind in ["Amplitude","Power"]:
                actual = row[kind.lower()+"Moments"]
                expected = row["exactPositiveSupport"+kind+"Moments"]
                for name in ["meanMHz","varianceMHz2"]:
                    check(case["id"]+"/"+grid["id"]+"/"+kind+"/"+name,
                          abs(actual[name]-expected[name]) <= tol,
                          dict(actual=actual[name],expected=expected[name],tolerance=tol))
            for name in ["integral", "meanMHz", "varianceMHz2"]:
                # For an unfiltered uniform PSD, trapezoid variance exceeds the
                # exact continuous value by df^2/6; integral/mean remain exact.
                allowance = grid["stepMHz"]**2/6 + 5e-12 if case["receiver"]=="none" and name=="varianceMHz2" else spec["acceptance"]["ordinaryMomentAbsoluteTolerance"]
                check(case["id"]+"/"+grid["id"]+"/noise-rx-only/"+name,
                      abs(row["receiverNoiseMoments"][name]-row["exactReceiverNoiseMoments"][name]) <= allowance)
            check(case["id"]+"/"+grid["id"]+"/direct-vs-ifft",
                  row["directIfftMaxRelativeError"] <= spec["acceptance"]["normalizedDirectIfftAbsoluteTolerance"])
            # The near-DC stress has appreciable endpoint amplitude; use the
            # declared derivative bound instead of pretending it has vanishing tails.
            quadrature_allowance = row["conservativeInverseQuadratureRelativeBound"] if case["id"]=="positive-support-stress" else 0
            check(case["id"]+"/"+grid["id"]+"/positive-support-bound",
                  row["wholeAxisInverseMaxRelativeError"] <= row["wholeAxisInverseOmissionBound"]+quadrature_allowance+spec["acceptance"]["analyticInverseNumericalAllowanceRelative"])
            bracket = row["fftEnvelopeFwhmUs"].get("widthCellInterval")
            check(case["id"]+"/"+grid["id"]+"/inverse-fwhm-cell",
                  bracket is not None and bracket[0]-1e-10 <= row["directEnvelopeFwhmUs"] <= bracket[1]+1e-10)
    by = {(r["case"],r["grid"]["id"]):r for r in rows}
    for case in spec["cases"]:
        a,b,c = [by[(case["id"],g)] for g in ["coarse","refined","support"]]
        check(case["id"]+"/frequency-refinement",
              abs(a["directEnvelopeFwhmUs"]-b["directEnvelopeFwhmUs"]) <= spec["acceptance"]["quadratureRootFrequencyRefinementAbsoluteToleranceUs"])
        for name in ["meanMHz","varianceMHz2"]:
            check(case["id"]+"/support/"+name,
                  abs(b["amplitudeMoments"][name]-c["amplitudeMoments"][name]) <= spec["acceptance"]["supportChangeMomentAbsoluteTolerance"])
    get = lambda case: by[(case,"refined")]
    for a,b in [("liver-100","liver-split"),("mixed","mixed-reversed")]:
        ya=arrays[a.replace("-","_")+"__refined__amplitudeSpectrum"]
        yb=arrays[b.replace("-","_")+"__refined__amplitudeSpectrum"]
        check(a+"/"+b+"/same-spectrum", np.max(np.abs(ya-yb)) <= np.max(np.abs(ya))*5e-14)
    for a in ["liver-100","fluid-100"]:
        check(a+"/receiver-noise-independent", get(a)["receiverNoiseBandlimitedPower"]==get("face")["receiverNoiseBandlimitedPower"])
    check("positive-support-stress-is-not-whole-gaussian",
          get("positive-support-stress")["amplitudeBandFwhmMHz"]["status"]=="missing-left"
          and get("positive-support-stress")["wholeAxisInverseOmissionBound"]>0.01)
    check("fixed-loss-preserves-centroid",
          abs(get("fixed-loss")["amplitudeMoments"]["meanMHz"]-get("liver-100")["amplitudeMoments"]["meanMHz"])<5e-12)
    check("fixed-loss-scales-amplitude",
          abs(get("fixed-loss")["amplitudeMoments"]["integral"]/get("liver-100")["amplitudeMoments"]["integral"]-0.1)<5e-14)
    check("receiver-band-explicit", get("narrow-receiver")["gaussianWholeAxisParameters"]["varianceMHz2"] < get("liver-100")["gaussianWholeAxisParameters"]["varianceMHz2"])

    # Counterfactuals: independent direct spectrum is held fixed.
    liver=get("liver-100"); a=liver["gaussianWholeAxisParameters"]
    target=liver["amplitudeMoments"]["meanMHz"]
    bad_centres=dict(
        amplitude_10log=a["muMHz"]-a["betaTotalPerMHz"]*a["varianceMHz2"],
        missing_return=a["muMHz"]+0.5*a["betaTotalPerMHz"]*a["varianceMHz2"],
        fixed_loss_as_slope=a["muMHz"]-DB_TO_NP*20/spec["source"]["muMHz"]*a["varianceMHz2"],
    )
    for name,value in bad_centres.items():
        check("negative/"+name, abs(value-target)>100*spec["acceptance"]["ordinaryMomentAbsoluteTolerance"],dict(wrongMuMHz=value,referenceMeanMHz=target))
    f=arrays["liver_100__refined__frequencyMHz"]
    bad_noise=arrays["liver_100__refined__receiverNoisePsd"]*np.exp(-2*a["betaTotalPerMHz"]*f)
    check("negative/noise-through-patient", abs(float(np.trapezoid(bad_noise,f))-liver["receiverNoiseBandlimitedPower"]) > 0.01*liver["receiverNoiseBandlimitedPower"])
    v0,_=parameters(spec)
    wrong_source_noise = arrays["liver_100__refined__receiverNoisePsd"]*np.exp(-(f-spec["source"]["muMHz"])**2/v0)
    check("negative/noise-through-source", abs(float(np.trapezoid(wrong_source_noise,f))-liver["exactReceiverNoiseMoments"]["integral"]) > 0.01*liver["exactReceiverNoiseMoments"]["integral"])
    k=2*DB_TO_NP*spec["slopes"]["liver"]/10*v0/spec["source"]["muMHz"]
    rational=spec["source"]["muMHz"]/(1+k*100)
    check("negative/rational-is-not-fixed-receiver",abs(rational-target)>100*spec["acceptance"]["ordinaryMomentAbsoluteTolerance"],dict(wrongContractMuMHz=rational,referenceMeanMHz=target))

    np.savez_compressed(args.out/"profiles.npz",**arrays)
    unchanged = sha(args.spec)==spec_hash and sha(__file__)==script_hash
    check("source-and-spec-unchanged", unchanged)
    report=dict(protocolId=spec["protocolId"],status="passed" if all(c["passed"] for c in checks) else "failed",
                interpretation="Independent mathematical oracle only; not calibrated transducer or accepted production change.",
                python=platform.python_version(),numpy=np.__version__,wallSeconds=time.perf_counter()-start,
                specSha256=spec_hash,scriptSha256=script_hash,profilesSha256=sha(args.out/"profiles.npz"),
                sourceUnchanged=unchanged,
                checks=checks,results=rows)
    (args.out/"report.json").write_text(json.dumps(report,indent=2,allow_nan=False)+"\n")
    print(json.dumps(dict(status=report["status"],checks=len(checks),failed=[c["name"] for c in checks if not c["passed"]],wallSeconds=report["wallSeconds"],out=str(args.out))))
    if report["status"]!="passed" or not report["sourceUnchanged"]:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
