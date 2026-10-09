import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { runAgent } from './agent'; // Ajusta si la función de entrada a tu agente tiene otro nombre

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('[API] Mensaje recibido:', message);

    if (!message) {
      return res.status(400).json({ response: 'El mensaje es requerido.' });
    }

    // Ejecuta la lógica principal del agente
    const result = await runAgent(message);
    console.log('[API] Respuesta generada:', result);

    const formattedResponse = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return res.json({ response: formattedResponse });

  } catch (error: any) {
    console.error('[API Error]:', error);
    return res.status(500).json({ 
      response: `Error interno en el servidor: ${error.message || error}` 
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
