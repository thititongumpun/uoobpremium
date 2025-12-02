/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your Worker in action
 * - Run `npm run deploy` to publish your Worker
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { InteractionType } from "discord-interactions";

function hexToUint8Array(hex: string) {
	const bytes = new Uint8Array(Math.ceil(hex.length / 2));
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export default {
	async scheduled(event, env, ctx) {
		// แปลงเวลาให้เป็น Timezone ไทย (คร่าวๆ) หรือใช้ UTC ตาม Cron
		// หมายเหตุ: new Date() ใน Worker มักจะเป็น UTC
		const date = new Date();

		// ถ้า Cron ตั้งไว้เที่ยงคืนไทย (UTC+7) อาจจะต้องระวังเรื่องวันที่ข้ามวัน
		// แต่ถ้าเอาชัวร์ว่ารันวันที่ 1 ใช้ Logic นี้:
		const month = date.getMonth() + 1;
		const year = date.getFullYear();

		console.log(`⏳ Starting Cron Job for: ${month}/${year}`);

		// ==========================================
		// 1. เช็คก่อนว่าเดือนนี้เคยสร้างบิลไปรึยัง? (กันสร้างซ้ำ)
		// ==========================================
		const checkExist = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM Payments
      WHERE year = ? AND month = ?
    `).bind(year, month).first();

		if (checkExist) {
			console.log("⚠️ บิลของเดือนนี้ถูกสร้างไปแล้ว ข้ามขั้นตอน Insert");
		} else {
			console.log("🆕 ไม่พบข้อมูลเก่า กำลังสร้างบิลใหม่...");

			// ==========================================
			// 2. Insert ข้อมูลใหม่ให้ Customer ID 1, 2, 3, 4
			// ตัด payment_id ออก เพื่อให้มัน Auto Increment เอง
			// ==========================================
			try {
				await env.DB.prepare(`
          INSERT INTO Payments (year, month, is_paid, customer_id)
          VALUES
            (?, ?, 0, 1),
            (?, ?, 0, 2),
            (?, ?, 0, 3),
            (?, ?, 0, 4);
        `)
					.bind(
						year, month, // สำหรับคนแรก
						year, month, // สำหรับคนที่สอง
						year, month, // สำหรับคนที่สาม
						year, month  // สำหรับคนที่สี่
					).run();
				console.log("✅ Insert ข้อมูลเรียบร้อยแล้ว");
			} catch (err) {
				console.error("❌ Insert Failed:", err);
			}
		}

		// ==========================================
		// 3. ดึงข้อมูลเพื่อเตรียมประกาศ
		// ==========================================
		const { results } = await env.DB.prepare(`
          SELECT
            p.is_paid,
            c.name,
            c.discord_id
          FROM Payments p
          JOIN Customers c ON c.customer_id = p.customer_id
          WHERE p.year = ? AND p.month = ?
        `)
			.bind(year, month)
			.all();

		if (!results || results.length === 0) {
			console.log("No data found to report.");
			return;
		}

		// สร้างลิสต์รายชื่อ
		const statusList = results.map((row, index) => {
			// เนื่องจากเพิ่งสร้างบิล ทุกคนจะเป็น "ค้างจ่าย" (⏳)
			const isPaid = row.is_paid === 1;
			const icon = isPaid ? "✅" : "⏳";
			const statusText = isPaid ? "จ่ายแล้ว" : "รอชำระเงิน";

			// ใส่ Tag ชื่อ Discord เพื่อเรียกเก็บเงิน (ถ้ามี discord_id)
			const displayName = row.discord_id ? `<@${row.discord_id}>` : `**${row.name}**`;

			return `${index + 1}. ${icon} ${displayName} (${statusText})`;
		}).join('\n');

		const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
		const monthName = thaiMonths[month - 1] || month;

		// ==========================================
		// 4. สร้าง Embed ประกาศบิลใหม่
		// ==========================================
		const myEmbed = {
			title: `🔔 แจ้งเตือนชำระค่าบริการ ประจำเดือน${monthName} ${year}`,
			description: `บิลรอบใหม่มาแล้วครับทุกคน! รบกวนตรวจสอบและชำระค่าบริการด้วยนะครับ\n\n**รายชื่อสมาชิก:**\n${statusList}`,
			color: 0xe74c3c, // สีแดง (แจ้งเตือน) หรือ 0xe67e22 (สีส้ม)
			image: {
				url: "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXV3eGM2MWxmcWt6azE2ZmRteGpndXhsd3Bjbnc0cmtscWdnMndxNSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cXMFmN3edhlHI5vRsG/giphy.gif" // (Optional) ใส่ GIF ทวงเงินขำๆ ถ้าต้องการ
			},
			footer: {
				text: `ระบบแจ้งเตือนอัตโนมัติ | ${new Date().toLocaleTimeString('th-TH')}`
			},
			timestamp: new Date().toISOString()
		};

		// ==========================================
		// 5. ส่ง Webhook
		// ==========================================
		await fetch(env.DISCORD_WEBHOOK_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				content: "📢 **ประกาศ: ค่าบริการรอบใหม่มาแล้วฮ้าฟฟู่**",
				embeds: [myEmbed]
			})
		});

		console.log("Cron executed and notification sent.");
	},
	async fetch(request, env, ctx) {
		// 1. เช็คว่าเป็น GET หรือไม่ (เผื่อเปิดผ่าน Browser)
		if (request.method === 'GET') {
			return new Response(`👋 Hello! Discord Bot Worker is active (Native Crypto Mode).`);
		}

		// 2. เตรียมข้อมูล Header และ Body
		const signature = request.headers.get('x-signature-ed25519');
		const timestamp = request.headers.get('x-signature-timestamp');
		const body = await request.text();

		if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
			return new Response('Missing headers or public key', { status: 401 });
		}

		// 3. เริ่มกระบวนการ Verify แบบ Native (ไม่ต้องใช้ Library)
		try {
			const key = await crypto.subtle.importKey(
				"raw",
				hexToUint8Array(env.DISCORD_PUBLIC_KEY),
				{ name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
				false,
				["verify"]
			);

			const encoder = new TextEncoder();
			const isVerified = await crypto.subtle.verify(
				"NODE-ED25519",
				key,
				hexToUint8Array(signature),
				encoder.encode(timestamp + body)
			);

			if (!isVerified) {
				return new Response('Invalid Signature', { status: 401 });
			}
		} catch (err) {
			// กรณีใส่ Key ผิดหรือ format ไม่ถูก
			if (err instanceof Error) {
				return new Response('Error verify signature: ' + err.message, { status: 401 })
			}
		}

		// 4. ถ้าผ่าน Verify มาถึงตรงนี้ได้ แปลว่าปลอดภัยแน่นอน
		const interaction = JSON.parse(body);

		// --- ตอบกลับ Discord (PING -> PONG) ---
		if (interaction.type === InteractionType.PING) {
			console.log("✅ PING received, returning PONG");
			return new Response(JSON.stringify({ type: 1 }), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// --- ตอบกลับ Slash Command ---
		if (interaction.type === InteractionType.APPLICATION_COMMAND) {
			if (interaction.data.name === 'status') {
				const userId = interaction.member.user.id;
				const userName = interaction.member.user.username;

				// 2. สร้างข้อความตอบกลับ
				return new Response(JSON.stringify({
					type: 4,
					data: {
						// ลองใส่ <@userId> เพื่อ Tag ชื่อคนเรียก
						content: `สวัสดีครับคุณ <@${userId}>! (ID ของคุณคือ: ${userId})`,
						embeds: [{
							title: "ข้อมูลผู้ใช้งาน",
							color: 0x0099ff,
							fields: [
								{ name: "ผู้เรียกคำสั่ง", value: userName, inline: true },
								{ name: "User ID", value: userId, inline: true }
							],
							thumbnail: {
								// ดึงรูปโปรไฟล์มาโชว์ด้วยก็ได้
								url: `https://cdn.discordapp.com/avatars/${userId}/${interaction.member.user.avatar}.png`
							}
						}]
					},
				}), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (interaction.data.name === 'checkbill') {
				const date = new Date();
				const month = date.getMonth() + 1;
				const year = date.getFullYear();

				// 1. ดึงข้อมูลของ "ทุกคน" ในเดือนนั้น (ตัด where discord_id ออก)
				// ใช้ .all() เพื่อดึงรายการทั้งหมดออกมา
				const { results } = await env.DB.prepare(`
          SELECT
            p.is_paid,
            c.name
          FROM Payments p
          JOIN Customers c ON c.customer_id = p.customer_id
          WHERE p.year = ? AND p.month = ?
        `)
					.bind(year, month)
					.all();

				// 2. เช็คว่ามีข้อมูลไหม
				if (!results || results.length === 0) {
					return new Response(JSON.stringify({
						type: 4,
						data: {
							embeds: [{
								title: "❌ ไม่พบรายการบิล",
								description: `ยังไม่มีข้อมูลบิลสำหรับเดือน ${month}/${year}`,
								color: 0x95a5a6,
							}]
						},
					}), { headers: { 'Content-Type': 'application/json' } });
				}

				// 3. แปลงข้อมูลลูกค้าแต่ละคนให้อยู่ในรูปแบบบรรทัดข้อความ (String)
				// ตัวอย่าง: "1. ✅ นาย ก." หรือ "2. ⏳ นาย ข."
				const statusList = results.map((row, index) => {
					const isPaid = row.is_paid === 1;
					const icon = isPaid ? "✅" : "⏳";
					const statusText = isPaid ? "จ่ายแล้ว" : "ค้างจ่าย";
					// จัดรูปแบบบรรทัด: ไอคอน ชื่อ - สถานะ
					return `${index + 1}. ${icon} **${row.name || 'ไม่ระบุชื่อ'}** (${statusText})`;
				}).join('\n'); // เชื่อมแต่ละคนด้วยการขึ้นบรรทัดใหม่

				// เช็คว่าจ่ายครบทุกคนไหม? (ถ้าครบสีเขียว, ถ้าไม่ครบสีแดง/ส้ม)
				const allPaid = results.every(r => r.is_paid === 1);
				const embedColor = allPaid ? 0x2ecc71 : 0xe67e22; // เขียว หรือ ส้ม

				const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
				const monthName = thaiMonths[month - 1] || month;

				// 4. สร้าง Embed อันเดียวรวมยอด
				return new Response(JSON.stringify({
					type: 4,
					data: {
						embeds: [
							{
								title: `🧾 สรุปยอดค่าบริการรอบเดือน ${monthName} ${year}`,
								description: `สถานะการชำระเงินของสมาชิกทั้งหมด`,
								color: embedColor,
								fields: [
									{
										name: "รายชื่อสมาชิก",
										value: statusList, // เอาข้อความที่เราวนลูปไว้มาใส่ตรงนี้
										inline: false
									},
									{
										name: "📊 สรุปภาพรวม",
										value: allPaid ? "🎉 จ่ายครบทุกคนแล้ว!" : "📢 มีสมาชิกที่ยังไม่ได้ชำระเงิน",
										inline: false
									}
								],
								footer: {
									text: `ข้อมูล ณ เวลา: ${new Date().toLocaleTimeString('th-TH')}`
								}
							}
						]
					},
				}), {
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response('Unknown command', { status: 400 });
	}
} satisfies ExportedHandler<Env>;
