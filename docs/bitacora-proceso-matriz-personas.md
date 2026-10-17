# Bitácora de Proceso · Matriz de personas para producción (Farmalógica)

Qué debe enviar **Amanda Casiano** (Farmalógica, producción) para cargar la Bitácora de
Proceso en producción, y cómo se carga. Revisión del 2026-10-15 (B8): cuatro actores y
cuatro vistos buenos (operario, supervisor, inspector y jefe de producción).

## 1. Lo que envía Amanda (un Excel sencillo, una hoja por rol o una columna «Rol»)

| Rol | Datos por persona | ¿Tiene usuario de SynerLink? |
|---|---|---|
| **Operario** | Nombre completo; documento (opcional) | **No.** Va al maestro de operarios. En la tablet toca su nombre. |
| **Supervisor** | Nombre completo; correo corporativo | **Sí.** Abre y cierra la bitácora (permiso «Bitácora de Proceso: Gestión»). |
| **Inspector** | Nombre completo; correo corporativo | **Sí.** Da su visto bueno después del cierre (permiso base del módulo). |
| **Jefe de producción** | Nombre completo; correo corporativo | **Sí.** Puede abrir y cerrar la bitácora de la que es jefe (sin Gestión, desde 2026-10-17); si la cierra el supervisor, da el último visto bueno (permiso base del módulo). |

Además, por favor:

- **Área(s)** donde se usa (hoy «Envase y agrafado»: confirmar la ortografía, B9).
- **Turnos** adicionales a Mañana (06–14), Tarde (14–22) y Noche (22–06), si los hay (B6, para después).
- Si una persona tiene dos roles (por ejemplo supervisor e inspector), indicarlo. En una
  misma bitácora el **inspector** debe ser distinto de quien abre y del jefe; quien abre sí puede
  ser el jefe de producción de esa bitácora (2026-10-17).

## 2. Cómo se carga

- **Operarios:** *Bitácora de Proceso → Catálogo → Operarios → Importar lista*. Se pega la
  lista (una persona por línea: `Nombre completo; documento`; también sirve copiar dos
  columnas de Excel). Primero muestra la vista previa (nuevos, ya existentes y errores) y
  luego se confirma. Solo crea nombres nuevos: no edita ni desactiva a nadie.
- **Supervisores, inspectores y jefes:** se crean como usuarios de SynerLink con la skill
  `crear-usuario-synerlink` (para producción, con autorización previa de Nicolás) en la
  empresa Farmalógica:
  - supervisores: subprocesos «Bitácora de Proceso» y «Bitácora de Proceso: Gestión»;
  - inspectores y jefes: subproceso «Bitácora de Proceso».
- **Asignar el rol (2026-10-16, obligatorio):** tener usuario y permiso NO basta. Cada
  supervisor, inspector y jefe se asigna a su rol en *Bitácora de Proceso → Catálogo →
  Responsables* (lo hace alguien con Gestión). Los selectores al abrir y al cerrar la
  bitácora listan **solo** a las personas asignadas, y el servidor rechaza a cualquier otra.
  El supervisor, además, debe tener el permiso de Gestión. Siembra inicial:
  `prisma/manual/2026-10-16-bitacora-proceso-responsables-farmalogica.sql` (Judy Alvarez
  inspectora; Karen Blanco y Tatiana Rico jefes; Amanda Casiano supervisora provisional).
- **Cuenta compartida «Producción»** (la de la tablet): usuario de SynerLink con el
  subproceso «Bitácora de Proceso». Se crea después, con autorización de Nicolás.
- **PIN de bitácora:** cada supervisor, inspector y jefe entra **una vez con su propia
  sesión** a *Bitácora de Proceso → Configurar PIN de bitácora* y fija su PIN de 4 dígitos
  (pide su contraseña de SynerLink para confirmar). Con ese PIN da su visto bueno en la
  tablet aunque esté abierta la cuenta «Producción». Desde su propia sesión no necesita PIN.
  Tras 5 intentos fallidos el PIN se bloquea; un supervisor lo restablece en
  *Catálogo → PIN* y la persona lo vuelve a configurar.

## 3. Pendiente (no incluido en este pase)

- **B4.** Responsables predefinidos (que supervisor, inspector y jefe vengan por defecto
  según la matriz). Por ahora se eligen a mano al abrir la bitácora.
- **B6.** Turnos configurables. **B7.** Entrada directa a la bitácora abierta. **B9.** Nombre del área.
