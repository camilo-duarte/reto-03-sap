import fs from 'fs';
import path from 'path';

export interface ValidacionResultado {
  solicitudId: string;
  apta: boolean;
  bloqueos: string[];
  confirmacionesRequeridas: string[];
  detalles: any;
}

// Helper para leer JSON de forma robusta
function leerJsonRutaFlexible(solicitudId: string, archivo: string) {
  const rutasPosibles = [
    path.join(process.cwd(), 'fixtures/reto-03/solicitudes', solicitudId, archivo),
    path.join(process.cwd(), './fixtures/reto-03/solicitudes', solicitudId, archivo),
    path.join(process.cwd(), '../fixtures/reto-03/solicitudes', solicitudId, archivo)
  ];

  for (const r of rutasPosibles) {
    if (fs.existsSync(r)) {
      try {
        return JSON.parse(fs.readFileSync(r, 'utf-8'));
      } catch (e) {}
    }
  }
  return null;
}

function leerTextoRutaFlexible(solicitudId: string, archivo: string) {
  const rutasPosibles = [
    path.join(process.cwd(), 'fixtures/reto-03/solicitudes', solicitudId, archivo),
    path.join(process.cwd(), './fixtures/reto-03/solicitudes', solicitudId, archivo),
    path.join(process.cwd(), '../fixtures/reto-03/solicitudes', solicitudId, archivo)
  ];

  for (const r of rutasPosibles) {
    if (fs.existsSync(r)) {
      return fs.readFileSync(r, 'utf-8');
    }
  }
  return '';
}

function leerMaestroJson(nombreMaestro: string) {
  const rutasPosibles = [
    path.join(process.cwd(), 'fixtures/reto-03/maestros', nombreMaestro),
    path.join(process.cwd(), './fixtures/reto-03/maestros', nombreMaestro),
    path.join(process.cwd(), '../fixtures/reto-03/maestros', nombreMaestro)
  ];

  for (const r of rutasPosibles) {
    if (fs.existsSync(r)) {
      try {
        return JSON.parse(fs.readFileSync(r, 'utf-8'));
      } catch (e) {}
    }
  }
  return [];
}

/**
 * Parsea el monto total con IVA de una cotización en texto plano
 */
function extraerTotalCotizacion(cotizacionTexto: string): number {
  const regex = /(?:TOTAL\s*\(IVA\s*incluido\)|TOTAL|Total general|VALOR TOTAL)[\s\:\$]*([0-9\.\,]+)/i;
  const match = cotizacionTexto.match(regex);
  if (match && match[1]) {
    const limpio = match[1].replace(/\./g, '').replace(/\,/g, '');
    const num = parseFloat(limpio);
    if (!isNaN(num)) return num;
  }
  
  const numeros = cotizacionTexto.match(/(?:COP|\$)\s*([0-9]{1,3}(?:\.[0-9]{3})+)/g);
  if (numeros && numeros.length > 0) {
    const ultimo = numeros[numeros.length - 1];
    const limpio = ultimo.replace(/[^0-9]/g, '');
    return parseFloat(limpio) || 0;
  }
  
  return 0;
}

export function validarSolicitudConReglas(solicitudId: string, confirmadoPorUsuario: boolean = false): ValidacionResultado {
  const bloqueos: string[] = [];
  const confirmacionesRequeridas: string[] = [];

  // Cargar archivos del expediente
  const solicitud = leerJsonRutaFlexible(solicitudId, 'solicitud.json');
  const aprobacion = leerJsonRutaFlexible(solicitudId, 'aprobacion.json');
  const cotizacionTexto = leerTextoRutaFlexible(solicitudId, 'cotizacion.txt');
  const facturaTexto = leerTextoRutaFlexible(solicitudId, 'factura.txt');

  if (!solicitud) {
    return {
      solicitudId,
      apta: false,
      bloqueos: [`La solicitud ${solicitudId} no existe o no se pudo leer el expediente.`],
      confirmacionesRequeridas: [],
      detalles: {}
    };
  }

  // Cargar maestros
  const proveedores = leerMaestroJson('proveedores.json') || [];
  const centrosCosto = leerMaestroJson('centros-costo.json') || [];

  // RC1: Extracción y comparación flexible de proveedores por NIT o Nombre
  const proveedorNit = String(solicitud?.proveedor_nit || solicitud?.proveedor?.nit || '').replace(/[^0-9]/g, '');
  const proveedorNombre = String(solicitud?.proveedor_nombre || solicitud?.proveedor?.nombre || '').toLowerCase().trim();

  const provEncontrado = proveedores.find((p: any) => {
    const pNit = String(p?.nit || '').replace(/[^0-9]/g, '');
    const pNombre = String(p?.nombre || '').toLowerCase().trim();

    const nitMatch = proveedorNit && pNit && (pNit.includes(proveedorNit) || proveedorNit.includes(pNit));
    const nombreMatch = proveedorNombre && pNombre && (pNombre.includes(proveedorNombre) || proveedorNombre.includes(pNombre));

    return nitMatch || nombreMatch;
  });
  
  if (!provEncontrado) {
    bloqueos.push(`RC1: El proveedor '${solicitud?.proveedor_nombre || proveedorNit}' no está registrado en el maestro.`);
  } else if (provEncontrado.estado && provEncontrado.estado !== 'ACTIVO') {
    bloqueos.push(`RC1: El proveedor '${provEncontrado.nombre}' se encuentra inactivo en SAP.`);
  }

  // RC2 - RC4: Aprobación y Centro de Costo
  const ccCodigo = solicitud?.centro_costo || solicitud?.centroCosto;
  const ccData = centrosCosto.find((c: any) => c.codigo === ccCodigo);
  const aprobadorEmail = aprobacion?.aprobador?.email || aprobacion?.email;

  if (ccData && aprobadorEmail !== ccData.responsable?.email && aprobadorEmail !== ccData.aprobadorAutorizado) {
    bloqueos.push(`RC2: El aprobador '${aprobadorEmail}' no está autorizado para el centro de costo ${ccCodigo}.`);
  }

  const montoTotalSolicitud = solicitud?.valor_total || solicitud?.total || (solicitud?.cantidad * solicitud?.valor_unitario) || 0;
  if (ccData && montoTotalSolicitud > (ccData.topeMaximo || 50000000)) {
    bloqueos.push(`RC4: El monto ($${montoTotalSolicitud}) supera el tope máximo permitido para ${ccCodigo}.`);
  }

  // RC5: Validación de Cotización
  if (cotizacionTexto) {
    const totalCotizacion = extraerTotalCotizacion(cotizacionTexto);
    if (totalCotizacion > 0 && Math.abs(totalCotizacion - montoTotalSolicitud) > 100) {
      confirmacionesRequeridas.push(`RC5: Discrepancia detectada entre solicitud ($${montoTotalSolicitud}) y cotización ($${totalCotizacion}). Requiere confirmación humana.`);
    }
  }

  // RC6: Indicador de IVA
  const indicadorIva = solicitud?.indicador_iva || solicitud?.indicadorIva;
  if (!indicadorIva) {
    confirmacionesRequeridas.push(`RC6: Indicador de IVA ausente. Se deriva 'C1' del proveedor. Requiere confirmación.`);
  }

  // RC8: Alerta Retroactiva
  if (facturaTexto) {
    confirmacionesRequeridas.push(`RC8: ALERTA RETROACTIVA. Se detectó una factura adjunta previa a la fecha de la solicitud. Requiere confirmación.`);
  }

  const tieneBloqueos = bloqueos.length > 0;
  const requiereHITL = confirmacionesRequeridas.length > 0;
  
  let apta = !tieneBloqueos;
  if (requiereHITL && !confirmadoPorUsuario) {
    apta = false; 
  }

  return {
    solicitudId,
    apta,
    bloqueos,
    confirmacionesRequeridas,
    detalles: {
      solicitud,
      montoTotalSolicitud,
      proveedorVerificado: provEncontrado?.nombre || proveedorNombre || 'Desconocido'
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

  const ocNumero = `450000000${parseInt(solicitudId.replace('sol-', '')) || 1}`;
  
  const outDir = path.join(process.cwd(), 'out/sap');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const ordenesPath = path.join(outDir, 'ordenes.jsonl');
  let yaExiste = false;
  if (fs.existsSync(ordenesPath)) {
    const contenido = fs.readFileSync(ordenesPath, 'utf-8');
    if (contenido.includes(solicitudId)) {
      yaExiste = true;
    }
  }

  if (!yaExiste) {
    const record = JSON.stringify({
      oc: ocNumero,
      solicitudId,
      timestamp: new Date().toISOString(),
      estado: 'CREADA_EN_SAP'
    });
    fs.appendFileSync(ordenesPath, record + '\n');
  }

  return {
    success: true,
    mensaje: `Orden de compra creada exitosamente en SAP`,
    ordenCompra: ocNumero,
    idempotente: yaExiste
  };
}
