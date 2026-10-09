import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// Inicialización de OpenAI si existe la clave en el entorno
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('[API] Mensaje recibido:', message);

    if (!message) {
      return res.status(400).json({ response: 'El mensaje es requerido.' });
    }

    // Respuesta del Agente
    let responseText = '';

    if (process.env.OPENAI_API_KEY) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Eres el asistente de control de compras SAP. Procesas solicitudes ejecutando reglas de control deterministas RC1-RC10.'
          },
          { role: 'user', content: message }
        ]
      });
      responseText = completion.choices[0]?.message?.content || 'Sin respuesta del modelo.';
    } else {
      responseText = `Procesando solicitud: "${message}". (Configura OPENAI_API_KEY en Render para respuestas de IA completas).`;
    }

    console.log('[API] Respuesta enviada:', responseText);
    return res.json({ response: responseText });

  } catch (error: any) {
    console.error('[API Error]:', error);
    return res.status(500).json({ 
      response: `Error en el servidor: ${error.message || error}` 
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
