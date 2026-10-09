import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir frontend estático
app.use(express.static(path.join(__dirname, '../web')));

// Inicializar cliente Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
});

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente');
});

// Cargar maestros de forma segura
function cargarMaestrosLigeros(): string {
  try {
    const maestrosPath = path.join(__dirname, '../fixtures/reto-03/maestros');
    if (!fs.existsSync(maestrosPath)) return '[]';

    const proveedores = path.join(maestrosPath, 'proveedores.json');
    const centrosCosto = path.join(maestrosPath, 'centros-costo.json');

    const provContent = fs.existsSync(proveedores) ? fs.readFileSync(proveedores, 'utf-8') : '[]';
    const ccContent = fs.existsSync(centrosCosto) ? fs.readFileSync(centrosCosto, 'utf-8') : '[]';

    return `PROVEEDORES:\n${provContent}\n\nCENTROS DE COSTO:\n${ccContent}`;
  } catch (err) {
    console.error('Error cargando maestros:', err);
    return '';
  }
}

// Cargar expedientes de solicitudes de forma limpia
function cargarExpedientesLigeros(): string {
  try {
    const solicitudesPath = path.join(__dirname, '../fixtures/reto-03/solicitudes');
    if (!fs.existsSync(solicitudesPath)) return '[]';

    const carpetas = fs.readdirSync(solicitudesPath);
    const resumenes: string[] = [];

    for (const carpeta of carpetas) {
      const carpetaPath = path.join(solicitudesPath, carpeta);
      if (fs.statSync(carpetaPath).isDirectory()) {
        const archivos = fs.readdirSync(carpetaPath);
        let detalle = `--- EXPEDIENTE: ${carpeta} ---\n`;

        for (const archivo of archivos) {
          const contenido = fs.readFileSync(path.join(carpetaPath, archivo), 'utf-8');
          detalle += `[${archivo}]:\n${contenido}\n`;
        }
        resumenes.push(detalle);
      }
    }

    return resumenes.join('\n');
  } catch (err) {
    console.error('Error cargando expedientes:', err);
    return '';
  }
}

// System Instruction unificada y concisa
const SYSTEM_INSTRUCTION = `Eres el Agente Conversacional experto en Control y Creación de Órdenes de Compra en SAP (Reto 03 - Periferia IT Group).

BASE DE DATOS MAESTROS Y EXPEDIENTES DISPONIBLES:
${cargarMaestrosLigeros()}

${cargarExpedientesLigeros()}

CONTROLES DE NEGOCIO (RC1 - RC10):
- RC1: Proveedor registrado y activo.
- RC2-RC4: Autoridad de aprobación según monto y centro de costo.
- RC5-RC7: Coincidencia entre cotización, correo, solicitud, indicador IVA y condición de pago.
- RC8: Alerta retroactiva si la fecha de factura.txt es previa a solicitud.json.
- RC10: Consistencia matemática (Cantidad * Valor Unitario = Valor Total).

INSTRUCCIONES:
1. Cuando el usuario pregunte por alguna solicitud (ej: "sol-001", "sol-002", "sol-005"), analiza sus documentos cargados.
2. Muestra un resumen del caso.
3. Evalúa las reglas RC1 a RC10.
4. Si detectas alertas (como compra retroactiva en sol-005 o problemas de monto), notifica que se requiere confirmación humana.
5. Si todo es conforme, declara la solicitud lista para la orden en SAP.`;

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
        console.error(`Error en intento ${attempt}:`, err?.message || err);

        const isTransient =
          err?.status === 503 ||
          err?.status === 429 ||
          err?.message?.includes('503') ||
          err?.message?.includes('429');

        if (isTransient && attempt < maxRetries) {
          const delay = attempt * 2000;
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
    console.error('Error final en /api/chat:', error?.message || error);
    res.status(500).json({
      error: 'Error interno en el servidor',
      details: error?.message || String(error),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
