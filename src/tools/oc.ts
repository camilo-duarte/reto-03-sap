import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Interfaces internas basadas en el PRD (Sección 7)
interface Solicitud {
  solicitud_id: string;
  solicitante: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  descripcion: string;
  centro_costo: string;
  subarea: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  moneda: "COP" | "USD";
  indicador_iva?: string;
  condiciones_pago?: string;
  fecha_solicitud: string;
}

interface Paquete {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion: { proveedor: string; nit: string | null; total: number; moneda: string; validez_hasta: string | null; texto: string } | null;
  aprobacion: { de: string; fecha: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string; fecha: string; total: number } | null;
}

function resolverRuta(raiz: string, rutaRelativa: string): string {
  return path.resolve(raiz, rutaRelativa);
}

// 1. oc_leer_paquete
export const oc_leer_paquete = {
  description: "Lee y normaliza los archivos de la carpeta del caso en fixtures.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso, por ejemplo 'sol-001'")
  },
  async execute(args: { caso: string }, ctx: { directory: string }) {
    try {
      const dirCaso = resolverRuta(ctx.directory, `fixtures/reto-03/solicitudes/${args.caso}`);
      if (!fs.existsSync(dirCaso)) {
        return JSON.stringify({ ok: false, error: `El caso ${args.caso} no existe.` });
      }

      const leerJSON = (file: string) => {
        const p = path.join(dirCaso, file);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
      };

      const leerTXT = (file: string) => {
        const p = path.join(dirCaso, file);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
      };

      const correo = leerJSON("correo.json");
      const solicitud = leerJSON("solicitud.json");
      const aprobacionRaw = leerJSON("aprobacion.json");
      const cotizacionTxt = leerTXT("cotizacion.txt");
      const facturaTxt = leerTXT("factura.txt");

      let aprobacion = null;
      if (aprobacionRaw) {
        aprobacion = {
          de: aprobacionRaw.de,
          fecha: aprobacionRaw.fecha,
          aprobado: aprobacionRaw.cuerpo ? aprobacionRaw.cuerpo.toLowerCase().includes("aprobado") : false,
          texto: aprobacionRaw.cuerpo || ""
        };
      }

      let cotizacion = null;
      if (cotizacionTxt) {
        const totalMatch = cotizacionTxt.match(/Total:\s*\$?([\d\.,]+)/i);
        const nitMatch = cotizacionTxt.match(/NIT:\s*([\d\-]+)/i);
        cotizacion = {
          proveedor: solicitud?.proveedor_nombre || "",
          nit: nitMatch ? nitMatch[1] : null,
          total: totalMatch ? parseFloat(totalMatch[1].replace(/\./g, "").replace(",", ".")) : solicitud?.valor_total || 0,
          moneda: solicitud?.moneda || "COP",
          validez_hasta: null,
          texto: cotizacionTxt
        };
      }

      let factura = null;
      if (facturaTxt) {
        const numMatch = facturaTxt.match(/Factura\s*#?:?\s*([\w\-]+)/i);
        const fechaMatch = facturaTxt.match(/Fecha:\s*([\d\-]+)/i);
        factura = {
          numero: numMatch ? numMatch[1] : "FACT-001",
          fecha: fechaMatch ? fechaMatch[1] : "2026-01-01",
          total: solicitud?.valor_total || 0
        };
      }

      const paquete: Paquete = { correo, solicitud, cotizacion, aprobacion, factura };
      return JSON.stringify({ ok: true, data: paquete });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }
};

// 2. oc_validar
export const oc_validar = {
  description: "Aplica las 10 reglas de control (RC1-RC10) sobre el paquete leido.",
  args: {
    caso: z.string().describe("Nombre del caso"),
    paquete: z.any().describe("Objeto Paquete normalizado")
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: { directory: string }) {
    try {
      const p = args.paquete;
      const dirMaestros = resolverRuta(ctx.directory, "fixtures/reto-03/maestros");

      const proveedores = JSON.parse(fs.readFileSync(path.join(dirMaestros, "proveedores.json"), "utf-8"));
      const centrosCosto = JSON.parse(fs.readFileSync(path.join(dirMaestros, "centros-costo.json"), "utf-8"));

      const bloqueos: string[] = [];
      const confirmaciones: string[] = [];
      const derivados: Record<string, any> = {};
      let retroactiva = false;

      // RC1: Proveedor
      const provMatch = proveedores.find((pr: any) => 
        (p.solicitud.proveedor_nit && pr.nit === p.solicitud.proveedor_nit) ||
        pr.nombre.toLowerCase().includes(p.solicitud.proveedor_nombre.toLowerCase())
      );

      if (!provMatch) {
        bloqueos.push(`RC1: El proveedor '${p.solicitud.proveedor_nombre}' no existe en el maestro.`);
      } else if (!provMatch.activo) {
        bloqueos.push(`RC1: El proveedor '${provMatch.nombre}' esta INACTIVO.`);
      } else {
        derivados.codigo_sap = provMatch.codigo_sap;
        derivados.proveedor_nit = provMatch.nit;
        derivados.proveedor_nombre = provMatch.nombre;
        derivados.indicador_iva_default = provMatch.indicador_iva_default;
        derivados.condiciones_pago_default = provMatch.condiciones_pago_default;
      }

      // RC2 & RC3 & RC4: Centro de costo, subárea, aprobador y tope
      const ccMatch = centrosCosto.find((c: any) => c.centro_costo === p.solicitud.centro_costo);
      if (!ccMatch) {
        bloqueos.push(`RC4: Centro de costo '${p.solicitud.centro_costo}' no existe.`);
      } else {
        if (!ccMatch.subareas.includes(p.solicitud.subarea)) {
          bloqueos.push(`RC4: Subarea '${p.solicitud.subarea}' no pertenece al centro de costo ${p.solicitud.centro_costo}.`);
        }

        if (!p.aprobacion || !p.aprobacion.aprobado) {
          bloqueos.push("RC2: No existe correo de aprobacion explicito ('Aprobado').");
        } else {
          const aprobadorMatch = ccMatch.aprobadores.find((a: any) => a.email.toLowerCase() === p.aprobacion!.de.toLowerCase());
          if (!aprobadorMatch) {
            bloqueos.push(`RC2: El correo '${p.aprobacion.de}' no esta autorizado como aprobador de ${p.solicitud.centro_costo}.`);
          } else if (p.solicitud.valor_total > aprobadorMatch.tope) {
            bloqueos.push(`RC3: El valor total (${p.solicitud.valor_total}) supera el tope permitido de ${aprobadorMatch.tope} para ${aprobadorMatch.nombre}.`);
          }
        }
      }

      // RC10: Cantidad * Valor Unitario = Valor Total
      if (Math.abs((p.solicitud.cantidad * p.solicitud.valor_unitario) - p.solicitud.valor_total) > 1) {
        bloqueos.push(`RC10: Inconsistencia numerica: cantidad * valor_unitario (${p.solicitud.cantidad * p.solicitud.valor_unitario}) != valor_total (${p.solicitud.valor_total}).`);
      }

      // RC5: Cotización vs Solicitud
      if (!p.cotizacion) {
        confirmaciones.push("RC5: No se adjunto cotizacion. Requiere confirmacion.");
      } else if (Math.abs(p.cotizacion.total - p.solicitud.valor_total) / p.solicitud.valor_total > 0.02) {
        confirmaciones.push(`RC5: Diferencia de cotizacion vs solicitud excede 2% (Cotizacion: ${p.cotizacion.total}, Solicitud: ${p.solicitud.valor_total}).`);
      }

      // RC6: Indicador IVA ausente
      if (!p.solicitud.indicador_iva) {
        const ivaDerivado = derivados.indicador_iva_default || "C1";
        derivados.indicador_iva = ivaDerivado;
        confirmaciones.push(`RC6: Indicador de IVA ausente. Se deriva '${ivaDerivado}' del proveedor. Requiere confirmacion.`);
      } else {
        derivados.indicador_iva = p.solicitud.indicador_iva;
      }

      // RC7: Condiciones de pago ausentes
      if (!p.solicitud.condiciones_pago) {
        derivados.condiciones_pago = derivados.condiciones_pago_default || "Z030";
      } else {
        derivados.condiciones_pago = p.solicitud.condiciones_pago;
      }

      // RC8: OC Retroactiva (Factura anterior a la solicitud)
      if (p.factura && new Date(p.factura.fecha) < new Date(p.solicitud.fecha_solicitud)) {
        retroactiva = true;
        confirmaciones.push(`RC8: ALERTA RETROACTIVA. La factura (${p.factura.fecha}) es anterior a la solicitud (${p.solicitud.fecha_solicitud}). Requiere confirmacion.`);
      }

      // RC9: Fecha de aprobación anterior a la solicitud
      if (p.aprobacion && new Date(p.aprobacion.fecha) < new Date(p.solicitud.fecha_solicitud)) {
        confirmaciones.push(`RC9: La fecha de aprobacion (${p.aprobacion.fecha}) es anterior a la fecha de solicitud (${p.solicitud.fecha_solicitud}).`);
      }

      const apta = bloqueos.length === 0;
      return JSON.stringify({ ok: true, data: { apta, bloqueos, confirmaciones, derivados, retroactiva } });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }
};

// 3. oc_construir_payload
export const oc_construir_payload = {
  description: "Construye la estructura final de OrdenCompra SAP y guarda la trazabilidad.",
  args: {
    caso: z.string(),
    paquete: z.any(),
    derivados: z.any()
  },
  async execute(args: { caso: string; paquete: Paquete; derivados: any }, ctx: { directory: string }) {
    try {
      const p = args.paquete;
      const d = args.derivados;

      const dirOutCaso = resolverRuta(ctx.directory, `out/${args.caso}`);
      fs.mkdirSync(dirOutCaso, { recursive: true });

      const sha256Evidencia = crypto.createHash("sha256").update(p.aprobacion?.texto || "").digest("hex");

      const payload = {
        referencia: {
          solicitud_id: p.solicitud.solicitud_id,
          correo_id: p.correo?.id || "N/A",
          cotizacion_ref: p.cotizacion ? "COT-ADJUNTA" : null
        },
        sociedad: "1000",
        organizacion_compras: "1000",
        proveedor: {
          codigo_sap: d.codigo_sap || "100000",
          nit: d.proveedor_nit || p.solicitud.proveedor_nit || "",
          nombre: d.proveedor_nombre || p.solicitud.proveedor_nombre
        },
        moneda: p.solicitud.moneda || "COP",
        condiciones_pago: d.condiciones_pago || "Z030",
        aprobador: {
          email: p.aprobacion?.de || "",
          fecha_aprobacion: p.aprobacion?.fecha || "",
          evidencia_sha256: sha256Evidencia
        },
        posiciones: [
          {
            numero: 10,
            descripcion: p.solicitud.descripcion.substring(0, 40),
            cantidad: p.solicitud.cantidad,
            unidad: "UN",
            precio_unitario: p.solicitud.valor_unitario,
            centro_costo: p.solicitud.centro_costo,
            subarea: p.solicitud.subarea,
            indicador_iva: d.indicador_iva || "C1"
          }
        ],
        excepciones: []
      };

      const trazabilidadPath = path.join(dirOutCaso, "trazabilidad.json");
      fs.writeFileSync(trazabilidadPath, JSON.stringify({ payload, fecha_creacion: new Date().toISOString() }, null, 2));

      return JSON.stringify({ ok: true, data: { payload, trazabilidadPath } });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }
};

// 4. oc_generar_evidencia
export const oc_generar_evidencia = {
  description: "Genera el archivo TXT de evidencia de aprobacion con su SHA256.",
  args: { caso: z.string(), paquete: z.any() },
  async execute(args: { caso: string; paquete: Paquete }, ctx: { directory: string }) {
    try {
      const p = args.paquete;
      const dirOutCaso = resolverRuta(ctx.directory, `out/${args.caso}`);
      fs.mkdirSync(dirOutCaso, { recursive: true });

      const contenido = `--- EVIDENCIA DE APROBACION ---
De: ${p.aprobacion?.de}
Fecha: ${p.aprobacion?.fecha}
Contenido: ${p.aprobacion?.texto}
--------------------------------`;

      const sha256 = crypto.createHash("sha256").update(contenido).digest("hex");
      const ruta = path.join(dirOutCaso, "aprobacion.txt");
      fs.writeFileSync(ruta, contenido);

      return JSON.stringify({ ok: true, data: { ruta, sha256 } });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }
};

// 5. oc_crear
export const oc_crear = {
  description: "Crea la Orden de Compra en el SAP simulado e incrementa el log de control.",
  args: {
    caso: z.string(),
    payload: z.any(),
    confirmado: z.boolean().optional(),
    retroactiva: z.boolean().optional()
  },
  async execute(args: { caso: string; payload: any; confirmado?: boolean; retroactiva?: boolean }, ctx: { directory: string }) {
    try {
      const dirSap = resolverRuta(ctx.directory, "out/sap");
      fs.mkdirSync(dirSap, { recursive: true });

      const ordenesFile = path.join(dirSap, "ordenes.jsonl");
      const controlCsv = resolverRuta(ctx.directory, "out/control.csv");

      // Idempotencia: Verificar si ya existe
      if (fs.existsSync(ordenesFile)) {
        const lineas = fs.readFileSync(ordenesFile, "utf-8").trim().split("\n");
        for (const l of lineas) {
          if (!l) continue;
          const o = JSON.parse(l);
          if (o.referencia.solicitud_id === args.payload.referencia.solicitud_id) {
            return JSON.stringify({ ok: true, data: { numero_oc: o.numero_oc, fecha: o.fecha_creacion, idempotente: true } });
          }
        }
      }

      // Obtener número secuencial desde 4500000001
      let secuencial = 4500000001;
      if (fs.existsSync(ordenesFile)) {
        const lineas = fs.readFileSync(ordenesFile, "utf-8").trim().split("\n").filter(Boolean);
        secuencial += lineas.length;
      }

      const numero_oc = secuencial.toString();
      const fecha = new Date().toISOString();

      const nuevaOrden = { numero_oc, fecha_creacion: fecha, ...args.payload };
      fs.appendFileSync(ordenesFile, JSON.stringify(nuevaOrden) + "\n");

      // Registrar en control.csv
      if (!fs.existsSync(controlCsv)) {
        fs.writeFileSync(controlCsv, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n");
      }
      fs.appendFileSync(controlCsv, `${args.payload.referencia.solicitud_id},EXITO,${numero_oc},${args.retroactiva || false},0,0,${fecha}\n`);

      return JSON.stringify({ ok: true, data: { numero_oc, fecha, idempotente: false } });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }
};
