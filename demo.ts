import { oc_leer_paquete, oc_validar, oc_construir_payload, oc_generar_evidencia, oc_crear } from "./src/tools/oc.js";
import * as fs from "fs";
import * as path from "path";

async function ejecutarDemo() {
  const ctx = { directory: process.cwd() };

  // Limpiar carpeta de salida
  const dirOut = path.join(ctx.directory, "out");
  if (fs.existsSync(dirOut)) {
    fs.rmSync(dirOut, { recursive: true, force: true });
  }

  console.log("=== INICIANDO PRUEBA DETERMINISTA DEMO.TS ===\n");

  const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"];

  for (const caso of casos) {
    console.log(`----------------------------------------`);
    console.log(`PROCESANDO: ${caso}`);
    console.log(`----------------------------------------`);

    // 1. Leer paquete
    const resPaquete = JSON.parse(await oc_leer_paquete.execute({ caso }, ctx));
    if (!resPaquete.ok) {
      console.log(`❌ Error leyendo paquete: ${resPaquete.error}`);
      continue;
    }
    const paquete = resPaquete.data;

    // 2. Validar reglas de control
    const resValidar = JSON.parse(await oc_validar.execute({ caso, paquete }, ctx));
    const { apta, bloqueos, confirmaciones, derivados, retroactiva } = resValidar.data;

    console.log(`Apta: ${apta}`);
    if (bloqueos.length > 0) console.log(`Bloqueos:`, bloqueos);
    if (confirmaciones.length > 0) console.log(`Confirmaciones requeridas:`, confirmaciones);

    if (!apta) {
      console.log(`🚫 RESULTADO: RECHAZADA POR CONTROLES INTERNOS\n`);
      continue;
    }

    // 3. Construir payload
    const resPayload = JSON.parse(await oc_construir_payload.execute({ caso, paquete, derivados }, ctx));
    const { payload } = resPayload.data;

    // 4. Generar evidencia de aprobación
    await oc_generar_evidencia.execute({ caso, paquete }, ctx);

    // 5. Crear en SAP Simulado (Manejo de confirmación en sol-004)
    const requiereConfirmacion = confirmaciones.length > 0;
    const confirmado = caso === "sol-004" ? true : !requiereConfirmacion;

    if (requiereConfirmacion && !confirmado) {
      console.log(`⚠️ RESULTADO: PENDIENTE DE CONFIRMACIÓN HUMANA\n`);
      continue;
    }

    const resCrear = JSON.parse(await oc_crear.execute({ caso, payload, confirmado, retroactiva }, ctx));
    if (resCrear.ok) {
      console.log(`✅ RESULTADO: OC CREADA EN SAP -> #${resCrear.data.numero_oc} (Idempotente: ${resCrear.data.idempotente})\n`);
    } else {
      console.log(`❌ ERROR AL CREAR OC: ${resCrear.error}\n`);
    }
  }

  // Prueba explícita de Idempotencia ejecutando sol-001 de nuevo
  console.log(`----------------------------------------`);
  console.log(`PRUEBA DE IDEMPOTENCIA: Re-ejecutando sol-001`);
  console.log(`----------------------------------------`);
  const resP001 = JSON.parse(await oc_leer_paquete.execute({ caso: "sol-001" }, ctx));
  const resV001 = JSON.parse(await oc_validar.execute({ caso: "sol-001", paquete: resP001.data }, ctx));
  const resB001 = JSON.parse(await oc_construir_payload.execute({ caso: "sol-001", paquete: resP001.data, derivados: resV001.data.derivados }, ctx));
  const resC001 = JSON.parse(await oc_crear.execute({ caso: "sol-001", payload: resB001.data.payload, confirmado: true }, ctx));
  console.log(`✅ RESULTADO IDEMPOTENCIA: OC #${resC001.data.numero_oc} (Idempotente: ${resC001.data.idempotente})\n`);
}

ejecutarDemo().catch(console.error);
