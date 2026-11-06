/**
 * MÓDULO FORMACIÓN — consultas a la base (2026-10-26). Las decisiones están en
 * `reglas.ts`; aquí solo se leen los datos que necesitan.
 */
import 'server-only';
import { prisma } from '../prisma';
import { formadoresDePortal } from '../portal/config';
import {
  EMPRESA_GLOBAL,
  cursoVisiblePara,
  SUBPROCESO_FORMACION,
  normalizarCorreo,
  par,
  puedeAdministrarCurso,
  type ContextoAdmin,
  type PerfilColaborador,
} from './reglas';

/** Empresas donde la persona tiene el permiso del módulo Formación. */
export async function contextoAdmin(correo: string): Promise<ContextoAdmin> {
  const filas = await prisma.$queryRaw<Array<{ id_company: number; company: string }>>`
    SELECT DISTINCT c.id_company, c.company
    FROM [subprocess_user_company] suc
    INNER JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN [company] c ON c.id_company = cu.id_company
    INNER JOIN [user] u ON u.id = cu.id_user
    INNER JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
    WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(${correo})))
      AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, '')))) = ${SUBPROCESO_FORMACION}
  `;
  const empresas = filas.map((f) => f.id_company);
  let esGlobal = filas.some((f) => f.company.trim().toUpperCase() === EMPRESA_GLOBAL);
  // Transición: los formadores configurados antes del módulo (PORTAL_TH_FORMADORES)
  // siguen administrando como GSS hasta que se les asigne el permiso en Usuarios.
  if (!esGlobal && empresas.length === 0 && formadoresDePortal().includes(normalizarCorreo(correo))) esGlobal = true;
  return { empresas, esGlobal };
}

/** Empresa(s) y departamento(s) del colaborador: SynerLink + carga de Talento Humano. */
export async function perfilColaborador(correo: string): Promise<PerfilColaborador> {
  const email = normalizarCorreo(correo);
  const [usuario, cargados] = await Promise.all([
    prisma.user.findFirst({
      where: { email },
      select: {
        companyUsers: { select: { id_company: true } },
        departmentUsers: { select: { id_department: true } },
      },
    }),
    prisma.formacionColaborador.findMany({ where: { email }, select: { id_company: true, id_department: true } }),
  ]);
  const empresas = new Set<number>();
  const departamentos = new Set<number>();
  const pares = new Set<string>();
  for (const cu of usuario?.companyUsers ?? []) empresas.add(cu.id_company);
  for (const du of usuario?.departmentUsers ?? []) departamentos.add(du.id_department);
  for (const c of cargados) {
    empresas.add(c.id_company);
    pares.add(par(c.id_company, c.id_department));
  }
  return { empresas, departamentos, pares };
}

/**
 * Correos que deben recibir la divulgación de un curso, según su alcance.
 * Sin alcance (todas las empresas): todos los usuarios activos de SynerLink y
 * todos los colaboradores cargados. Siempre se suman los inscritos.
 */
export async function destinatariosDeCurso(courseId: number): Promise<string[]> {
  const alcances = await prisma.formacionCursoAlcance.findMany({
    where: { course_id: courseId, activo: true },
    select: { id_company: true, id_department: true },
  });
  const total = await prisma.formacionCursoAlcance.count({ where: { course_id: courseId } });
  const correos = new Set<string>();
  const agregar = (c: string | null | undefined) => {
    if (c && c.includes('@')) correos.add(normalizarCorreo(c));
  };

  if (total === 0) {
    const [usuarios, colaboradores] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, role: { not: 'supplier' }, companyUsers: { some: {} } },
        select: { email: true },
      }),
      prisma.formacionColaborador.findMany({ select: { email: true } }),
    ]);
    usuarios.forEach((u) => agregar(u.email));
    colaboradores.forEach((c) => agregar(c.email));
  } else {
    for (const a of alcances) {
      const [usuarios, colaboradores] = await Promise.all([
        prisma.user.findMany({
          where: {
            isActive: true,
            role: { not: 'supplier' },
            companyUsers: { some: { id_company: a.id_company } },
            ...(a.id_department === null ? {} : { departmentUsers: { some: { id_department: a.id_department } } }),
          },
          select: { email: true },
        }),
        prisma.formacionColaborador.findMany({
          where: { id_company: a.id_company, ...(a.id_department === null ? {} : { id_department: a.id_department }) },
          select: { email: true },
        }),
      ]);
      usuarios.forEach((u) => agregar(u.email));
      colaboradores.forEach((c) => agregar(c.email));
    }
  }

  const inscritos = await prisma.portalCourseEnrollment.findMany({ where: { course_id: courseId }, select: { student_email: true } });
  inscritos.forEach((i) => agregar(i.student_email));
  return [...correos].sort();
}

/** Marca como vistas las divulgaciones pendientes de un curso (o de un material) para una persona. */
export async function marcarDivulgacionVista(correo: string, filtro: { courseId?: number; materialId?: number }): Promise<void> {
  const email = normalizarCorreo(correo);
  try {
    await prisma.formacionDivulgacionDestinatario.updateMany({
      where: {
        email,
        visto_at: null,
        divulgacion: filtro.materialId
          ? { material_id: filtro.materialId }
          : { course_id: filtro.courseId, material_id: null },
      },
      data: { visto_at: new Date() },
    });
  } catch (error) {
    // Nunca debe tumbar la pantalla del curso: el pendiente se limpia en la próxima visita.
    console.warn('[formacion] no se pudo marcar la divulgación como vista', (error as Error).message);
  }
}

export interface PendienteDto {
  id: number;
  courseId: number;
  materialId: number | null;
  titulo: string;
  material: string | null;
  mensaje: string | null;
  divulgadoAt: string;
}

/** Pendientes por ver de una persona (cursos o materiales divulgados que aún no abre). */
export async function pendientesDe(correo: string, limite = 20): Promise<{ total: number; items: PendienteDto[] }> {
  const email = normalizarCorreo(correo);
  const where = {
    email,
    visto_at: null,
    divulgacion: { course: { active: true, eliminado_at: null } },
  };
  const [total, filas] = await Promise.all([
    prisma.formacionDivulgacionDestinatario.count({ where }),
    prisma.formacionDivulgacionDestinatario.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limite,
      select: {
        id: true,
        divulgacion: {
          select: {
            course_id: true,
            material_id: true,
            mensaje: true,
            divulgado_at: true,
            course: { select: { title: true } },
          },
        },
      },
    }),
  ]);
  const materialIds = filas.map((f) => f.divulgacion.material_id).filter((x): x is number => x !== null);
  const materiales = materialIds.length
    ? await prisma.portalCourseMaterial.findMany({ where: { id: { in: materialIds } }, select: { id: true, title: true } })
    : [];
  const nombre = new Map(materiales.map((m) => [m.id, m.title]));
  return {
    total,
    items: filas.map((f) => ({
      id: f.id,
      courseId: f.divulgacion.course_id,
      materialId: f.divulgacion.material_id,
      titulo: f.divulgacion.course.title,
      material: f.divulgacion.material_id ? (nombre.get(f.divulgacion.material_id) ?? null) : null,
      mensaje: f.divulgacion.mensaje,
      divulgadoAt: f.divulgacion.divulgado_at.toISOString(),
    })),
  };
}

/**
 * ¿Es administrador de Formación (puede crear y configurar cursos)?
 * Los formadores de PORTAL_TH_FORMADORES siguen valiendo mientras se les asigna
 * el permiso del módulo en Usuarios (transición, sin consulta a la base).
 */
export async function esFormadorFormacion(correo: string): Promise<boolean> {
  if (formadoresDePortal().includes(normalizarCorreo(correo))) return true;
  try {
    const ctx = await contextoAdmin(correo);
    return ctx.esGlobal || ctx.empresas.length > 0;
  } catch (error) {
    console.warn('[formacion] no se pudo leer el permiso del módulo', (error as Error).message);
    return false;
  }
}

/** ¿Puede configurar ESTE curso? (empresa dueña del curso, o GSS para los de todas). */
export async function puedeAdministrarCursoId(correo: string, courseId: number): Promise<boolean> {
  if (formadoresDePortal().includes(normalizarCorreo(correo))) return true;
  try {
    const [ctx, curso] = await Promise.all([
      contextoAdmin(correo),
      prisma.portalCourse.findUnique({ where: { id: courseId }, select: { id_company_owner: true } }),
    ]);
    if (!curso) return ctx.esGlobal || ctx.empresas.length > 0; // la ruta responde 404 después
    return puedeAdministrarCurso(ctx, curso.id_company_owner ?? null);
  } catch (error) {
    console.warn('[formacion] no se pudo validar el permiso sobre el curso', (error as Error).message);
    return false;
  }
}

/**
 * ¿Puede ver (y preguntar en) este curso? El formador que lo administra sí,
 * siempre; un estudiante si el curso está publicado y está inscrito o en su
 * alcance. `modera` = puede borrar preguntas de otros (formador del curso).
 */
export async function accesoAlCurso(correo: string, courseId: number): Promise<{ puede: boolean; modera: boolean }> {
  const curso = await prisma.portalCourse.findFirst({
    where: { id: courseId, eliminado_at: null },
    select: { active: true, alcances: { select: { id_company: true, id_department: true, activo: true } } },
  });
  if (!curso) return { puede: false, modera: false };
  if (await puedeAdministrarCursoId(correo, courseId)) {
    if (await esFormadorFormacion(correo)) return { puede: true, modera: true };
  }
  if (!curso.active) return { puede: false, modera: false };
  const inscrito = await prisma.portalCourseEnrollment.findUnique({
    where: { course_id_student_email: { course_id: courseId, student_email: correo } },
    select: { id: true },
  });
  if (inscrito || curso.alcances.length === 0) return { puede: true, modera: false };
  return { puede: cursoVisiblePara(curso.alcances, await perfilColaborador(correo)), modera: false };
}
