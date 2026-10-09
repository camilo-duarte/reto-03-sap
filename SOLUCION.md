# Solución Técnica - Reto 03: Agente Conversacional "Órdenes de Compra SAP"
**Candidato:** Camilo Antonio Duarte Martinez  
**Fecha:** Octubre 2026  

---

## 1. Problema en una frase
Eliminar la digitación manual en la creación de órdenes de compra en SAP, garantizando el cumplimiento estricto de la matriz de autorización y midiendo las desviaciones por compras retroactivas.

## 2. Arquitectura del Sistema
- **Frontend:** Interfaz de chat HTML/JS ligera con renderizado de llamadas a herramientas e indicadores de confirmación humana.
- **Backend:** Node 20+ con Express y Vercel AI SDK (`ai` / `@ai-sdk/openai`).
- **Separación de Responsabilidades:**
  - **Comportamiento:** Defindo en `agent/prompt.md` (System Prompt).
  - **Ejecución y Reglas de Negocio:** Encapsulado estrictamente en TypeScript con esquemas Zod en `src/tools/oc.ts`.
  - **Capa SAP (Simulada):** Implementada en `src/sap/` escribiendo de forma idempotente en `out/sap/ordenes.jsonl` y auditando en `out/control.csv`.

## 3. Ciclo del Agente y Human-in-the-Loop
1. **Extracción y Validación:** El modelo invoca `oc_leer_paquete` y `oc_validar`.
2. **Evaluación de Controles:** Las herramientas retornan un vector de `bloqueos` y `confirmaciones`.
3. **Pausa por Confirmación Humana:** Si se detectan alertas (RC5, RC6, RC8), el modelo presenta el caso al usuario y suspende la ejecución hasta recibir confirmación explícita.
4. **Idempotencia:** `oc_crear` verifica si la solicitud ya fue registrada en `out/sap/ordenes.jsonl` evitando duplicados.

## 4. Matriz de Controles Implementada (RC1 - RC10)
- **RC1 (Proveedor Activo):** Validación contra `proveedores.json` por NIT/Nombre[cite: 2, 6].
- **RC2 - RC4 (Autoridad y Centro de Costo):** Verificación de aprobador autorizado y tope de monto en `centros-costo.json`[cite: 2, 3].
- **RC5 - RC7 (Cotización, IVA y Pago):** Derivación automática de IVA/Condiciones y alertas por diferencias $>2\%$[cite: 2, 4, 5].
- **RC8 (Alerta Retroactiva):** Detección de facturas emitidas con fecha anterior a la solicitud[cite: 2].
- **RC10 (Consistencia Matemática):** Verificación exacta de `cantidad * valor_unitario = valor_total`[cite: 2].

## 5. Diseño de Integración SAP Real (Proyección a Producción)
- **Estrategia Elegida:** OData via SAP Integration Suite (API `API_PURCHASEORDER_PROCESS_SRV`) o BAPI vía RFC (`BAPI_PO_CREATE1`) para garantizar transaccionalidad[cite: 2].
- **Seguridad:** Autenticación OAuth2 / Principal Propagation con credenciales almacenadas en Key Vault (nunca en el prompt ni en el agente)[cite: 2].
- **Plan B (Si no hay conectividad BAPI/OData):** Generación de lote plano en formato BDC / LSMW para carga masiva[cite: 2].

## 6. Declaración del Uso de IA
- **Asistentes Utilizados:** Claude / ChatGPT para apoyo en el diseño de arquitectura, estructuración de esquemas Zod y generación de pruebas deterministas en TypeScript.
