// ============================================================
// Netlify Function: notify-reservation
//
// Recibe un POST desde el frontend (index.html) cada vez que
// se reserva o cancela un regalo, y envía un email a
// reservas@unregaloparabea.es a través de la API de Resend.
//
// La API key de Resend vive SOLO aquí (variable de entorno
// RESEND_API_KEY configurada en Netlify), nunca en el cliente.
// ============================================================

const NOTIFY_TO = "reservas@unregaloparabea.es";
const NOTIFY_FROM = "Lista de regalos <notificaciones@unregaloparabea.es>";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: "RESEND_API_KEY no configurada" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }

  const { action, giftName, personName, timestamp } = payload;

  if (action !== "reserved" && action !== "cancelled") {
    return { statusCode: 400, body: "action inválida" };
  }
  if (!giftName || typeof giftName !== "string") {
    return { statusCode: 400, body: "giftName es obligatorio" };
  }

  const date = timestamp ? new Date(timestamp) : new Date();
  const fecha = date.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
  const hora = date.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid" });

  const isReserved = action === "reserved";
  const subject = isReserved
    ? `Nueva reserva: ${giftName}`
    : `Reserva cancelada: ${giftName}`;

  const html = `
    <div style="font-family: sans-serif; font-size: 15px; color: #333;">
      <h2 style="margin-bottom: 8px;">${isReserved ? "🎁 Nueva reserva" : "❌ Reserva cancelada"}</h2>
      <p><strong>Regalo:</strong> ${escapeHtml(giftName)}</p>
      <p><strong>${isReserved ? "Reservado por" : "Lo tenía reservado"}:</strong> ${escapeHtml(personName || "(desconocido)")}</p>
      <p><strong>Fecha:</strong> ${fecha}</p>
      <p><strong>Hora:</strong> ${hora}</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { statusCode: 502, body: `Error de Resend: ${text}` };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: `Error enviando email: ${err.message}` };
  }
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
