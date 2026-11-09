
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");

const warnings = new Map();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(
    process.env.AUTH_DIR || "./auth_info"
  );

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("SCAN THIS QR WITH JAY BOT NUMBER:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("JAY BOT IS ONLINE!");
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;

      if (status !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 5000);
      } else {
        console.log("WhatsApp logged out. Reconnect manually.");
      }
    }
  });

  sock.ev.on("group-participants.update", async (event) => {
    if (event.action === "add") {
      for (const participant of event.participants) {
        await sock.sendMessage(event.id, {
          text: `👋 Welcome to the group!\n\n🤖 JAY BOT is watching over this group.\nPlease read the group rules and respect everyone.`
        });
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith("@g.us")) continue;

      const sender = msg.key.participant;
      if (!sender) continue;

      const content = msg.message;
      const body =
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        "";

      if (!body) continue;

      const isLink =
        /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/)/i.test(body);

      if (!isLink) continue;

      try {
        const metadata = await sock.groupMetadata(jid);
        const members = metadata.participants;

        const senderInfo = members.find(p => p.id === sender);
        const botInfo = members.find(p => p.id === sock.user.id);

        if (!senderInfo || !botInfo) continue;

        // Admins are exempt
        if (senderInfo.admin) continue;

        // Bot must be an admin
        if (!botInfo.admin) continue;

        // Delete unauthorized link
        await sock.sendMessage(jid, {
          delete: msg.key
        });

        const warningKey = `${jid}:${sender}`;
        const count = (warnings.get(warningKey) || 0) + 1;
        warnings.set(warningKey, count);

        if (count >= 3) {
          await sock.sendMessage(jid, {
            text: `🚫 Member removed after ${count} link violations.`
          });

          await sock.groupParticipantsUpdate(
            jid,
            [sender],
            "remove"
          );

          warnings.delete(warningKey);
        } else {
          await sock.sendMessage(jid, {
            text: `⚠️ WARNING ${count}/3\nLinks are not allowed here.\nPlease follow the group rules.`
          });
        }
      } catch (error) {
        console.log("Moderation error:", error.message);
      }
    }
  });
}

startBot().catch(console.error);
        
