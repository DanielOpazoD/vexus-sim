# Dominio anatómico explícito del banco

Fuente: `f40a4930062a90e9d159466cdd6d8e9e8f60e618`, PR228. Este seguimiento conserva su contexto
de la decisión191 de PR226, documentada en la historia de la rama Atlas.
No cambia el arranque ni las guardas del simulador.

**Seguimiento: dominio explícito del banco.** El auditor omitía `abdomen`
al pedir `--anatomy legacy`, pero el arranque actual solo selecciona el modelo
anterior con `abdomen=legacy`. La captura era del atlas y el control de dominio
la rechazaba. `windowAudit.ts` conserva ahora en la URL el dominio solicitado,
tanto `legacy` como `atlas`; no relaja ese control ni cambia la aplicación.
La reproducción en navegador de ambos dominios y la fuente exacta deben
acompañar el PR. Una captura anterior solo se acepta por su dominio registrado:
no se invalida ni se valida retrospectivamente todo un banco por este defecto.
