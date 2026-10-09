import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir frontend estático da pasta 'web'
app.use(express.static(path.join(__dirname, '../web')));

// Inicializar o cliente oficial do Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
});

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor rodando corretamente');
});

// 1. Carregar Dados Mestres Corporativos (Maestros)
function cargarMaestros(): Record<string, any> {
  const maestrosPath = path.join(__dirname, '../fixtures/reto-03/maestros');
  const maestros: Record<string, any> = {};

  if (fs.existsSync(maestrosPath)) {
    const archivos = fs.readdirSync(maestrosPath);
    for (const archivo of archivos) {
      if (archivo.endsWith('.json')) {
        const contenido = fs.readFileSync(path.join(maestrosPath, archivo), 'utf-8');
        try {
          maestros[archivo.replace('.json', '')] = JSON.parse(contenido);
        } catch {
          maestros[archivo.replace('.json', '')] = contenido;
        }
      }
    }
    console.log(`[OK] Maestros cargados: ${Object.keys(maestros).join(', ')}`);
  } else {
    console.warn(`[WARN] Ruta de maestros no encontrada: ${maestrosPath}`);
  }

  return maestros;
}

// 2. Carregar Expedientes de Solicitações (sol-001 a sol-006)
function cargarExpedientes(): any[] {
  const solicitudesPath = path.join(__dirname, '../fixtures/reto-03/solicitudes');
  const expedientes: any[] = [];

  if (fs.existsSync(solicitudesPath)) {
    const carpetas = fs.readdirSync(solicitudesPath);

    for (const carpeta of carpetas) {
      const carpetaPath = path.join(solicitudesPath, carpeta);

      if (fs.statSync(carpetaPath).isDirectory()) {
        const expediente: Record<string, any> = {
          solicitud_id_folder: carpeta,
          documentos: {}
        };

        const archivos = fs.readdirSync(carpetaPath);
        for (const archivo of archivos) {
          const archivoPath = path.join(carpetaPath, archivo);
          const contenido = fs.readFileSync(archivoPath, 'utf-8');

          if (archivo.endsWith('.json')) {
            try {
              expediente.documentos[archivo] = JSON.parse(contenido);
            } catch {
              expediente.documentos[archivo] = contenido;
            }
          } else {
            expediente.documentos[archivo] = contenido;
          }
        }

        expedientes.push(expediente);
      }
    }
    console.log(`[OK] Cargadas ${expedientes.length} solicitudes completas.`);
  } else {
    console.warn(`[WARN] Ruta de solicitudes no encontrada: ${solicitudesPath}`);
  }

  return expedientes;
}

// Carregar contexto em memória ao iniciar o servidor
const MAESTROS_DATA = JSON.stringify(cargarMaestros(), null, 2);
const EXPEDIENTES_DATA = JSON.stringify(cargarExpedientes(), null, 2);

// System Instruction para o Agente Conversacional SAP
const SYSTEM_INSTRUCTION = `Eres el Agente Conversacional experto en Control y Creación de Órdenes de Compra en SAP (Reto 03 - Periferia IT Group).

DATOS MAESTROS DE REFERENCIA (Sistemas Corporativos):
${MAESTROS_DATA}

EXPEDIENTES DIGITALES DE SOLICITUDES (sol-001 a sol-006):
${EXPEDIENTES_DATA}

MATRIZ DE CONTROLES DE NEGOCIO Y REGLAS DE VALIDACIÓN (RC1 - RC10):
- RC1 (Proveedor Activo): Validar NIT/Nombre contra 'proveedores'.
- RC2-RC4 (Autoridad y Centro de Costo): Verificar si el aprobador está autorizado y si el monto supera el tope en 'centros-costo'.
- RC5-RC7 (Cotización, IVA y Pago): Validar coincidencia de valores e indicadores con 'indicadores-iva' y 'condiciones-pago'.
- RC8 (Alerta Retroactiva): Si existe 'factura.txt', detectar si la fecha de emisión es anterior a la fecha de la solicitud.
- RC10 (Consistencia Matemática): Verificar estrictamente que (Cantidad * Valor Unitario = Valor Total).

INSTRUCCIONES DE RESPUESTA:
1. Cuando el usuario solicite procesar o consultar una solicitud (ej. "sol-001", "sol-005", "SOL-2026-001"):
   - Presenta la información resumida del caso.
   - Detalla el resultado de la validación de cada regla (RC1 a RC10).
   - Si se detecta alguna anomalía (ej. compra retroactiva RC8 o inconformidad de monto RC2-RC4), notifica que se requiere confirmación humana antes de proceder.
   - Si la solicitud es válida y cumple con todos los controles, indica que está lista para la creación de la Orden de Compra en SAP.
2. Si se consulta una solicitud inexistente, infórmalo amablemente.`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    let reply = '';
    let lastError: any = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: message,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
          },
        });

        reply = response.text || 'Sin respuesta del modelo.';
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        const isTransient =
          err?.status === 503 ||
          err?.status === 429 ||
          err?.message?.includes('503') ||
          err?.message?.includes('429');

        if (isTransient && attempt < maxRetries) {
          const delay = attempt * 2000;
          console.warn(`[Intento ${attempt}/${maxRetries}] Reintentando por alta demanda en ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }

        break;
      }
    }

    if (lastError && !reply) {
      throw lastError;
    }

    res.json({ success: true, response: reply });
  } catch (error: any) {
    console.error('Error al comunicarse con Gemini API:', error);
    res.status(500).json({
      error: 'Error interno en el servidor',
      details: error.message || error,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
