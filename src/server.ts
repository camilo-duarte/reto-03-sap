import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { oc_leer_paquete, oc_validar, oc_construir_payload, oc_generar_evidencia, oc_crear } from "./tools/oc.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("web"));

const PORT = process.env.PORT || 3000;
const systemPrompt = fs.readFileSync(path.join(process.cwd(), "agent/prompt.md"), "utf-8");

app.get("/api/health", (req, res) => {
  res.json({ ok: true, provider: "OpenAI", model: "gpt-4o-mini" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const ctx = { directory: process.cwd() };

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system: systemPrompt,
      prompt: message,
      tools: {
        oc_leer_paquete: {
          description: oc_leer_paquete.description,
          parameters: oc_leer_paquete.args,
          execute: async (args: any) => JSON.parse(await oc_leer_paquete.execute(args, ctx))
        },
        oc_validar: {
          description: oc_validar.description,
          parameters: oc_validar.args,
          execute: async (args: any) => JSON.parse(await oc_validar.execute(args, ctx))
        },
        oc_construir_payload: {
          description: oc_construir_payload.description,
          parameters: oc_construir_payload.args,
          execute: async (args: any) => JSON.parse(await oc_construir_payload.execute(args, ctx))
        },
        oc_generar_evidencia: {
          description: oc_generar_evidencia.description,
          parameters: oc_generar_evidencia.args,
          execute: async (args: any) => JSON.parse(await oc_generar_evidencia.execute(args, ctx))
        },
        oc_crear: {
          description: oc_crear.description,
          parameters: oc_crear.args,
          execute: async (args: any) => JSON.parse(await oc_crear.execute(args, ctx))
        }
      },
      maxSteps: 10
    });

    res.json({
      reply: result.text,
      toolCalls: result.toolCalls || []
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`);
});
