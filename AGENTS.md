# Trabajar en VExUS Sim

1. Lee `docs/CONTINUIDAD.md`: cierre funcional acreditado, alcance vigente y límites. Las instrucciones
   actuales del usuario prevalecen sobre cualquier instantánea histórica.
2. Lee `docs/MISION.md` y `CONTRIBUTING.md`: misión, aceptación y fusión. `CLAUDE.md` resume los
   invariantes delicados; `docs/ARCHITECTURE.md` y `docs/TESTING.md` explican los contratos.
3. Entorno: `tools/workspace/run.sh npm run workspace:doctor`. Comandos y evidencias en
   `docs/engineering/workspace.md`. Node 24; una sola carga intensiva local a la vez.
   Durante la edición usa feedback focalizado según `docs/engineering/iteration.md`; check y CI
   completos siguen siendo obligatorios para aceptar el candidato final.
4. Consulta `docs/DECISIONS_INDEX.md` antes de abrir el historial completo. No conviertas un pendiente
   histórico en trabajo actual sin revisar el cierre y Git/CI.

No amplíes plazos, reduzcas física/resolución/aserciones ni omitas hooks para conseguir verde.
No elimines evidencias negativas ni procesos ajenos. No confundas CI verde, merge, despliegue y
validación clínica. No introduzcas dependencias o frameworks para ordenar el entorno.
