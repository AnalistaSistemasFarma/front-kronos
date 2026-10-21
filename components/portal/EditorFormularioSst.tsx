'use client';

import { useState } from 'react';
import { ConstructorFormulario } from './ConstructorFormulario';
import { VisorFormulario } from './FormularioPropio';
import type { DefinicionFormulario } from '../../lib/portal/formulario';

/**
 * FORMULARIOS SST — editor de formularios para el administrador (Cristian Baldión, 2026-10-20): el MISMO constructor visual de Formación
 * (preguntas, tipos, vista previa, importar desde un enlace de Microsoft Forms), en modo encuesta y con la autorización de datos de
 * Seguridad y Salud en el Trabajo. Guarda en `/api/portal/formularios-sst/definiciones`, que solo acepta al administrador y crea una
 * VERSIÓN NUEVA en SharePoint (nada se borra). Los errores del servidor salen ARRIBA, en rojo, dentro del propio constructor.
 */

export type InicioEditor = { nuevo: true } | { nuevo: false; definicion: DefinicionFormulario };

export default function EditorFormularioSst({ inicio, onCerrar }: { inicio: InicioEditor; onCerrar: (guardado: { titulo: string; nuevo: boolean } | null) => void }) {
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const [previa, setPrevia] = useState<DefinicionFormulario | null>(null);

  const guardar = async (definicion: DefinicionFormulario) => {
    setGuardando(true);
    setErrores([]);
    try {
      const res = await fetch('/api/portal/formularios-sst/definiciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definicion, nuevo: inicio.nuevo }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; errores?: unknown; formulario?: { titulo?: string } };
      if (!res.ok) {
        const lista = Array.isArray(data.errores) ? (data.errores as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        setErrores(lista.length > 0 ? lista : [String(data.error ?? 'No se pudo guardar el formulario.')]);
        return;
      }
      onCerrar({ titulo: data.formulario?.titulo ?? definicion.titulo, nuevo: inicio.nuevo });
    } catch {
      setErrores(['No se pudo guardar el formulario. Revise su conexión e intente de nuevo.']);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div data-testid='editor-formulario-sst'>
      <ConstructorFormulario
        key={inicio.nuevo ? 'nuevo' : inicio.definicion.codigo}
        tipo='encuesta'
        soloEncuesta
        contexto='sst'
        definicion={inicio.nuevo ? undefined : inicio.definicion}
        guardando={guardando}
        erroresServidor={errores}
        onGuardar={guardar}
        onVistaPrevia={(d) => setPrevia(d)}
        onCancelar={() => onCerrar(null)}
      />
      {previa && <VisorFormulario titulo={`Vista previa · ${previa.titulo}`} previa={previa} onCerrar={() => setPrevia(null)} />}
    </div>
  );
}
