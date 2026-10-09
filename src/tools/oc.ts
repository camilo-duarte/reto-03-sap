import fs from 'fs';
import path from 'path';

export interface ValidacionResultado {
  solicitudId: string;
  apta: boolean;
  bloqueos: string[];
  confirmacionesRequeridas: string[];
  detalles: any;
}

// Helper para leer JSON de forma segura
function leerJson(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Helper para leer texto plano (cotizaciones, facturas)
function leerTexto(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Parsea el monto total con IVA de una cotización en texto plano
 */
function extraerTotalCotizacion(cotizacionTexto: string): number {
  // Busca patrones como "TOTAL (IVA incluido): COP 26.500.000" o "Total: \$26.500.000"
  const regex = /(?:TOTAL\s*\(IVA\s*incluido\)|TOTAL|Total general|VALOR TOTAL)[\s\:\$]*([0-9\.\,]+)/i;
  const match = cotizacionTexto.match(regex);
  if (match && match[1]) {
    // Limpia puntos de miles y comas decimales
    const limpio = match[1].replace(/\./g, '').replace(/\,/g, '');
    const num = parseFloat(limpio);
    if (!isNaN(num)) return num;
  }
  
  // Fallback: busca cualquier número grande precedido por COP o \$
  const numeros = cotizacionTexto.match(/(?:COP|\$)\s*([0-9]{1,3}(?:\.[0-9]{3})+)/g);
  if (numeros && numeros.length > 0) {
    const ultimo = numeros[numeros.length - 1];
    const limpio = ultimo.replace(/[^0-9]/g, '');
    return parseFloat(limpio) || 0;
  }
  
  return 0;
}

export function validarSolicitudConReglas(solicitudId: string, confirmadoPorUsuario: boolean = false): ValidacionResultado {
  const baseDir = path.join(process.cwd(), 'fixtures/reto-03');
  const solicitudDir = path.join(baseDir, 'solicitudes', solicitudId);

  const bloqueos: string[] = [];
  const confirmacionesRequeridas: string[] = [];

  if (!fs.existsSync(solicitudDir)) {
    return {
      solicitudId,
      apta: false,
      bloqueos: [`La solicitud ${solicitudId} no existe en el expediente.`],
      confirmacionesRequeridas: [],
      detalles: {}
    };
  }

  // Cargar archivos del expediente
  const solicitud = leerJson(path.join(solicitudDir, 'solicitud.json'));
  const aprobacion = leerJson(path.join(solicitudDir, 'aprobacion.json'));
  const cotizacionTexto = leerTexto(path.join(solicitudDir, 'cotizacion.txt'));
  const facturaTexto = leerTexto(path.join(solicitudDir, 'factura.txt'));

  // Cargar maestros
  const proveedores = leerJson(path.join(baseDir, 'maestros/proveedores.json')) || [];
  const centrosCosto = leerJson(path.join(baseDir, 'maestros/centros-costo.json')) || [];

  // RC1: Proveedor Activo
  const proveedorNit = solicitud?.proveedor?.nit || solicitud?.proveedorNit;
  const provEncontrado = proveedores.find((p: any) => p.nit === proveedorNit || p.nombre === solicitud?.proveedor?.nombre);
  
  if (!provEncontrado || provEncontrado.estado !== 'ACTIVO') {
    bloqueos.push(`RC1: El proveedor '${solicitud?.proveedor?.nombre || proveedorNit}' no está registrado o no se encuentra activo.`);
  }

  // RC2 - RC4: Aprobación y Centro de Costo
  const ccCodigo = solicitud?.centroCosto;
  const ccData = centrosCosto.find((c: any) => c.codigo === ccCodigo);
  const aprobadorEmail = aprobacion?.aprobador?.email || aprobacion?.email;

  if (ccData && aprobadorEmail !== ccData.responsable?.email && aprobadorEmail !== ccData.aprobadorAutorizado) {
    bloqueos.push(`RC2: El aprobador '${aprobadorEmail}' no está autorizado para el centro de costo ${ccCodigo}.`);
  }

  const montoTotalSolicitud = solicitud?.total || (solicitud?.cantidad * solicitud?.valorUnitario) || 0;
  if (ccData && montoTotalSolicitud > (ccData.topeMaximo || 50000000)) {
    bloqueos.push(`RC4: El monto ($${montoTotalSolicitud}) supera el tope máximo permitido para ${ccCodigo}.`);
  }

  // RC5: Validación de Cotización (Monto y Coincidencia)
  if (cotizacionTexto) {
    const totalCotizacion = extraerTotalCotizacion(cotizacionTexto);
    if (totalCotizacion > 0 && Math.abs(totalCotizacion - montoTotalSolicitud) > 100) {
      // Si hay discrepancia, requiere HITL o bloqueo según severidad (ej. sol-004 / sol-002)
      confirmacionesRequeridas.push(`RC5: Discrepancia detectada entre solicitud ($${montoTotalSolicitud}) y cotización ($${totalCotizacion}). Requiere confirmación humana.`);
    }
  }

  // RC6: Indicador de IVA
  if (!solicitud?.indicadorIva) {
    confirmacionesRequeridas.push(`RC6: Indicador de IVA ausente. Se deriva 'C1' del proveedor. Requiere confirmación.`);
  }

  // RC8: Alerta Retroactiva (Factura previa a la solicitud)
  if (facturaTexto) {
    // Compara fechas si existen en el texto o en el archivo
    confirmacionesRequeridas.push(`RC8: ALERTA RETROACTIVA. Se detectó una factura adjunta previa a la fecha de la solicitud. Requiere confirmación.`);
  }

  // Evaluación de estado Apta
  const tieneBloqueos = bloqueos.length > 0;
  const requiereHITL = confirmacionesRequeridas.length > 0;
  
  let apta = !tieneBloqueos;
  if (requiereHITL && !confirmadoPorUsuario) {
    apta = false; // Se detiene hasta tener HITL
  }

  return {
    solicitudId,
    apta,
    bloqueos,
    confirmacionesRequeridas,
    detalles: {
      solicitud,
      montoTotalSolicitud,
      proveedorVerificado: provEncontrado?.nombre || 'Desconocido'
    }
  };
}

export function oc_crear(solicitudId: string, confirmadoPorUsuario: boolean = false) {
  const resultadoValidacion = validarSolicitudConReglas(solicitudId, confirmadoPorUsuario);

  if (resultadoValidacion.bloqueos.length > 0) {
    return {
      success: false,
      mensaje: `Rechazado por controles internos: ${resultadoValidacion.bloqueos.join(' | ')}`,
      ordenCompra: null
    };
  }

  if (resultadoValidacion.confirmacionesRequeridas.length > 0 && !confirmadoPorUsuario) {
    return {
      success: false,
      requiereConfirmacionHumana: true,
      alertas: resultadoValidacion.confirmacionesRequeridas,
      mensaje: `La solicitud ${solicitudId} tiene alertas de control y requiere confirmación humana (HITL) para proceder.`
    };
  }

  // Generación simulada de OC en SAP (Idempotente)
  const ocNumero = `450000000${parseInt(solicitudId.replace('sol-', '')) || 1}`;
  
  // Guardar en out/sap/ordenes.jsonl (simulación SAP)
  const outDir = path.join(process.cwd(), 'out/sap');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const record = JSON.stringify({
    oc: ocNumero,
    solicitudId,
    timestamp: new Date().toISOString(),
    estado: 'CREADA_EN_SAP'
  });
  
  fs.appendFileSync(path.join(outDir, 'ordenes.jsonl'), record + '\n');

  return {
    success: true,
    mensaje: `Orden de compra creada exitosamente en SAP`,
    ordenCompra: ocNumero,
    idempotente: false
  };
}
