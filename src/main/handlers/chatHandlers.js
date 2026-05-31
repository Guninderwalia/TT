/**
 * Chat Handlers — direct-message chat between employees
 *
 * Data model:
 *   chat_conversations  — one row per chat (1:1 today, group-ready)
 *   chat_participants    — one row per (conversation, user)
 *   chat_messages        — one row per message, append-only
 *
 * Real-time delivery:
 *   The Express server in webServer.js exposes /api/chat/stream?userId=…
 *   as a Server-Sent Events endpoint. Each connected client keeps an
 *   EventSource open; on every new message we broadcast to every recipient
 *   that's currently connected. Clients also poll on focus to catch missed
 *   events (e.g. a brief disconnect).
 */

const { v4: uuidv4 } = require('uuid');
const { writeAudit } = require('./_auditHelper');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Per-message attachment cap. Anything larger and the renderer should warn
// the user before reading the file at all, but we double-check here too.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Resolve (and lazily create) the on-disk directory chat attachments live in.
// Co-located with the SQLite DB under app.getPath('userData') so backups /
// uninstalls already cover it.
function attachmentsDir() {
  const dir = path.join(app.getPath('userData'), 'chat-attachments');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

// Strip everything except letters/digits/dot/dash from a filename's extension
// so we never write a path with surprising characters or traversal sequences.
function safeExt(filename) {
  const m = String(filename || '').match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? `.${m[1].toLowerCase()}` : '';
}

// userId → Set<{res: ExpressResponse, lastPing: Date}>
// Populated by webServer when a client opens an SSE connection. We keep the
// set in this module so the message handler can broadcast to it.
const _subscribers = new Map();

function addSubscriber(userId, res) {
  if (!userId) return;
  if (!_subscribers.has(userId)) _subscribers.set(userId, new Set());
  _subscribers.get(userId).add(res);
}

function removeSubscriber(userId, res) {
  const set = _subscribers.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) _subscribers.delete(userId);
}

function broadcast(userId, event, payload) {
  const set = _subscribers.get(userId);
  if (!set || set.size === 0) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch (_) { /* dead socket, will get cleaned up */ }
  }
}

function register(ipcMain, db) {
  // -------------------------------------------------------------------------
  // List active employees the caller can start a chat with. Excludes the
  // caller themselves and inactive accounts.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:listContacts', async (_event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId is required' };
      const rows = await db.all(
        `SELECT u.id, u.full_name, u.email, u.profile_picture_path,
                d.name as department_name, r.name as role_name
         FROM users u
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.status = 'active' AND u.id != ?
         ORDER BY u.full_name`,
        [userId]
      );
      return {
        success: true,
        data: rows.map(r => ({
          id: r.id,
          fullName: r.full_name,
          email: r.email,
          profilePicturePath: r.profile_picture_path,
          departmentName: r.department_name,
          roleName: r.role_name
        }))
      };
    } catch (error) {
      console.error('[CHAT] listContacts error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // List conversations the caller is part of, plus the other participant's
  // info (for direct chats) and an unread count.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:listConversations', async (_event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId is required' };
      // Pull each conversation the user is in, plus the latest message snippet
      // and unread count (messages newer than the participant's last_read_at).
      //
      // We wrap both columns in datetime() so the comparison is normalised —
      // legacy rows where last_read_at was written via CURRENT_TIMESTAMP
      // (space-separated) still compare correctly against sent_at values that
      // are ISO ("T"-separated). Without this the unread count never falls
      // to zero because 'T' (84) > ' ' (32) as raw text.
      const rows = await db.all(
        `SELECT c.id as conversation_id,
                c.type,
                c.name,
                c.last_message_at,
                me.last_read_at,
                (SELECT content FROM chat_messages m
                   WHERE m.conversation_id = c.id
                   ORDER BY m.sent_at DESC LIMIT 1) as last_message,
                (SELECT attachment_name FROM chat_messages m
                   WHERE m.conversation_id = c.id
                   ORDER BY m.sent_at DESC LIMIT 1) as last_attachment_name,
                (SELECT sender_id FROM chat_messages m
                   WHERE m.conversation_id = c.id
                   ORDER BY m.sent_at DESC LIMIT 1) as last_sender_id,
                (SELECT COUNT(*) FROM chat_messages m
                   WHERE m.conversation_id = c.id
                     AND m.sender_id != ?
                     AND (me.last_read_at IS NULL OR datetime(m.sent_at) > datetime(me.last_read_at))
                ) as unread_count
         FROM chat_participants me
         JOIN chat_conversations c ON c.id = me.conversation_id
         WHERE me.user_id = ?
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
        [userId, userId]
      );

      // For direct chats, look up the OTHER participant so the UI can show
      // their name and avatar.
      const convs = [];
      for (const row of rows) {
        let other = null;
        if (row.type === 'direct') {
          other = await db.get(
            `SELECT u.id, u.full_name, u.profile_picture_path,
                    d.name as department_name, r.name as role_name
             FROM chat_participants p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN departments d ON u.department_id = d.id
             LEFT JOIN roles r ON u.role_id = r.id
             WHERE p.conversation_id = ? AND p.user_id != ?
             LIMIT 1`,
            [row.conversation_id, userId]
          );
        }
        // Conversation preview: prefer the text body, but fall back to a
        // paperclip + filename for attachment-only messages so the list still
        // shows something meaningful.
        const previewText = row.last_message && row.last_message.length > 0
          ? row.last_message
          : (row.last_attachment_name ? `📎 ${row.last_attachment_name}` : '');
        convs.push({
          conversationId: row.conversation_id,
          type: row.type,
          name: row.name,
          lastMessage: previewText,
          lastSenderId: row.last_sender_id,
          lastMessageAt: row.last_message_at,
          lastReadAt: row.last_read_at,
          unreadCount: row.unread_count || 0,
          other: other ? {
            id: other.id,
            fullName: other.full_name,
            profilePicturePath: other.profile_picture_path,
            departmentName: other.department_name,
            roleName: other.role_name
          } : null
        });
      }
      return { success: true, data: convs };
    } catch (error) {
      console.error('[CHAT] listConversations error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Find-or-create a 1:1 conversation between userId and otherUserId.
  // Returns the conversation id either way.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:startConversation', async (_event, { userId, otherUserId } = {}) => {
    try {
      if (!userId || !otherUserId) return { success: false, message: 'userId and otherUserId are required' };
      if (userId === otherUserId)   return { success: false, message: 'Cannot chat with yourself' };

      // Check for an existing direct conversation with both as participants
      const existing = await db.get(
        `SELECT c.id
         FROM chat_conversations c
         JOIN chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
         JOIN chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
         WHERE c.type = 'direct'
         LIMIT 1`,
        [userId, otherUserId]
      );
      if (existing) {
        return { success: true, data: { conversationId: existing.id, created: false } };
      }

      // Create new conversation + two participant rows
      const convId = uuidv4();
      await db.run(
        `INSERT INTO chat_conversations (id, type) VALUES (?, 'direct')`,
        [convId]
      );
      await db.run(
        `INSERT INTO chat_participants (id, conversation_id, user_id) VALUES (?, ?, ?)`,
        [uuidv4(), convId, userId]
      );
      await db.run(
        `INSERT INTO chat_participants (id, conversation_id, user_id) VALUES (?, ?, ?)`,
        [uuidv4(), convId, otherUserId]
      );
      // Audit — who started a chat with whom
      await writeAudit(db, userId, {
        action: 'CHAT_CONVERSATION_START',
        entityType: 'CHAT_CONVERSATION',
        entityId: convId,
        oldValue: null,
        newValue: { type: 'direct', participants: [userId, otherUserId] }
      });
      // Notify the other participant via SSE so their sidebar refreshes
      broadcast(otherUserId, 'conversation:new', { conversationId: convId, by: userId });
      return { success: true, data: { conversationId: convId, created: true } };
    } catch (error) {
      console.error('[CHAT] startConversation error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Get messages for a conversation. Optional `since` filters to messages
  // sent strictly after that ISO timestamp (used by polling fallback).
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:getMessages', async (_event, { userId, conversationId, since } = {}) => {
    try {
      if (!userId || !conversationId) {
        return { success: false, message: 'userId and conversationId are required' };
      }
      // Verify the caller is actually in this conversation
      const member = await db.get(
        `SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, userId]
      );
      if (!member) return { success: false, message: 'Not a participant' };

      const params = [conversationId];
      let sql = `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.sent_at,
                        m.attachment_path, m.attachment_name, m.attachment_size, m.attachment_mime,
                        u.full_name as sender_name, u.profile_picture_path as sender_picture
                 FROM chat_messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.conversation_id = ?`;
      if (since) { sql += ' AND m.sent_at > ?'; params.push(since); }
      sql += ' ORDER BY m.sent_at ASC';
      const rows = await db.all(sql, params);
      return {
        success: true,
        data: rows.map(r => ({
          id: r.id,
          conversationId: r.conversation_id,
          senderId: r.sender_id,
          senderName: r.sender_name,
          senderPicture: r.sender_picture,
          content: r.content,
          sentAt: r.sent_at,
          attachmentPath: r.attachment_path,
          attachmentName: r.attachment_name,
          attachmentSize: r.attachment_size,
          attachmentMime: r.attachment_mime
        }))
      };
    } catch (error) {
      console.error('[CHAT] getMessages error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Send a message. Inserts, updates the conversation's last_message_at,
  // and broadcasts to every other participant over SSE.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:sendMessage', async (_event, { userId, conversationId, content, attachment } = {}) => {
    try {
      if (!userId || !conversationId) {
        return { success: false, message: 'userId and conversationId are required' };
      }
      const trimmed = String(content || '').trim();
      // Messages are allowed to be attachment-only — only error when *both*
      // a caption and an attachment are missing.
      if (!trimmed && !attachment) return { success: false, message: 'Message cannot be empty' };
      if (trimmed.length > 4000) return { success: false, message: 'Message is too long (max 4000 chars)' };

      const member = await db.get(
        `SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, userId]
      );
      if (!member) return { success: false, message: 'Not a participant' };

      // Persist the attachment to disk before the DB row so we don't end up
      // with a row pointing at a file that failed to write.
      let attachmentRow = null;
      if (attachment) {
        try {
          if (!attachment.base64 || !attachment.name) {
            return { success: false, message: 'Attachment is missing data' };
          }
          const buf = Buffer.from(attachment.base64, 'base64');
          if (buf.length > MAX_ATTACHMENT_BYTES) {
            return { success: false, message: 'Attachment too large (max 10 MB)' };
          }
          const fileId = uuidv4();
          const fullPath = path.join(attachmentsDir(), `${fileId}${safeExt(attachment.name)}`);
          fs.writeFileSync(fullPath, buf);
          attachmentRow = {
            path: fullPath,
            name: String(attachment.name).slice(0, 255),
            size: buf.length,
            mime: String(attachment.mime || 'application/octet-stream').slice(0, 255)
          };
        } catch (e) {
          console.error('[CHAT] attachment write failed:', e);
          return { success: false, message: 'Could not save attachment: ' + e.message };
        }
      }

      const id = uuidv4();
      // SQLite's CURRENT_TIMESTAMP gives second precision — generate our own
      // millisecond ISO string so the SSE payload and the row match.
      const sentAt = new Date().toISOString();
      // The text body of an attachment-only message is stored as empty
      // string (NOT NULL column) so existing read-paths don't need to
      // coalesce.
      await db.run(
        `INSERT INTO chat_messages (id, conversation_id, sender_id, content, sent_at,
                                    attachment_path, attachment_name, attachment_size, attachment_mime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, conversationId, userId, trimmed, sentAt,
          attachmentRow?.path || null,
          attachmentRow?.name || null,
          attachmentRow?.size || null,
          attachmentRow?.mime || null
        ]
      );
      await db.run(
        `UPDATE chat_conversations SET last_message_at = ? WHERE id = ?`,
        [sentAt, conversationId]
      );

      // Pull sender info for the broadcast payload (saves the receiver one round-trip)
      const sender = await db.get(
        `SELECT full_name, profile_picture_path FROM users WHERE id = ?`,
        [userId]
      );
      const messagePayload = {
        id,
        conversationId,
        senderId: userId,
        senderName: sender ? sender.full_name : 'Unknown',
        senderPicture: sender ? sender.profile_picture_path : null,
        content: trimmed,
        sentAt,
        attachmentPath: attachmentRow?.path || null,
        attachmentName: attachmentRow?.name || null,
        attachmentSize: attachmentRow?.size || null,
        attachmentMime: attachmentRow?.mime || null
      };
      // Broadcast to every other participant
      const otherParticipants = await db.all(
        `SELECT user_id FROM chat_participants WHERE conversation_id = ? AND user_id != ?`,
        [conversationId, userId]
      );
      for (const p of otherParticipants) {
        broadcast(p.user_id, 'message:new', messagePayload);
      }
      // Also notify the sender's other open clients (multi-tab support)
      broadcast(userId, 'message:new', messagePayload);

      // Audit — every chat message gets one row. We store the conversation
      // + recipients + length, but NOT the message body (PII; the body
      // already lives in chat_messages and can be looked up by id if needed).
      await writeAudit(db, userId, {
        action: 'CHAT_MESSAGE_SEND',
        entityType: 'CHAT_MESSAGE',
        entityId: id,
        oldValue: null,
        newValue: {
          conversationId,
          recipients: otherParticipants.map(p => p.user_id),
          length: trimmed.length
        }
      });

      return { success: true, data: messagePayload };
    } catch (error) {
      console.error('[CHAT] sendMessage error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Mark a conversation read by updating last_read_at to now.
  //
  // IMPORTANT: we use `new Date().toISOString()` instead of SQLite's
  // CURRENT_TIMESTAMP so the column has the SAME shape as sent_at — namely
  // the ISO "2026-05-30T20:42:00.500Z" format with a 'T' separator and
  // millisecond precision. Two reasons:
  //
  //   1. String comparison: SQLite compares datetimes as text by default. If
  //      last_read_at is "2026-05-30 20:42:00" (space) and sent_at is
  //      "2026-05-30T20:42:00.500Z" (T), then sent_at > last_read_at always
  //      returns true because 'T' (ASCII 84) > ' ' (ASCII 32). The unread
  //      badge would never clear — exactly the bug the user is hitting.
  //
  //   2. Millisecond precision: CURRENT_TIMESTAMP is second-only. If the
  //      user opens a conversation in the same second that a message arrived,
  //      the message's fractional seconds make it look "newer" than the read
  //      marker.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:markRead', async (_event, { userId, conversationId } = {}) => {
    try {
      if (!userId || !conversationId) {
        return { success: false, message: 'userId and conversationId are required' };
      }
      const now = new Date().toISOString();
      await db.run(
        `UPDATE chat_participants SET last_read_at = ?
         WHERE conversation_id = ? AND user_id = ?`,
        [now, conversationId, userId]
      );
      return { success: true };
    } catch (error) {
      console.error('[CHAT] markRead error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Total unread messages across all conversations (for the sidebar badge).
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:getUnreadCount', async (_event, { userId } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId is required' };
      // Wrap both columns in datetime() — see listConversations for the
      // 'T' vs ' ' string-comparison gotcha this guards against.
      const row = await db.get(
        `SELECT COUNT(*) as cnt
         FROM chat_messages m
         JOIN chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
         WHERE m.sender_id != ?
           AND (p.last_read_at IS NULL OR datetime(m.sent_at) > datetime(p.last_read_at))`,
        [userId, userId]
      );
      return { success: true, data: { count: row ? row.cnt || 0 : 0 } };
    } catch (error) {
      console.error('[CHAT] getUnreadCount error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Voice / video call signalling. WebRTC peers exchange SDP offers/answers
  // and ICE candidates through this relay — we never touch the media itself,
  // only the negotiation packets. Rides the same SSE channel the chat does so
  // no extra infra is needed.
  //
  // Accepted `type` values:
  //   'offer'   — caller's SDP offer; recipient sees the incoming-call modal
  //   'answer'  — callee's SDP answer
  //   'ice'     — ICE candidate (either direction, sent multiple times per call)
  //   'hangup'  — caller cancelled OR either party ended an active call
  //   'reject'  — callee declined an incoming offer
  //
  // The recipient's renderer maps each type to a UI / RTCPeerConnection action.
  // We optionally append a chat_messages row marker ("📞 Missed call" /
  // "📞 Call ended") so the conversation history shows what happened.
  // -------------------------------------------------------------------------
  ipcMain.handle('call:signal', async (_event, { fromUserId, toUserId, type, payload, conversationId } = {}) => {
    try {
      if (!fromUserId || !toUserId || !type || !conversationId) {
        return { success: false, message: 'fromUserId, toUserId, type and conversationId are required' };
      }
      // Confirm both the caller and the callee are participants of this
      // conversation — otherwise anyone could spam call invitations.
      const fromOk = await db.get(
        `SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, fromUserId]
      );
      const toOk = await db.get(
        `SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, toUserId]
      );
      if (!fromOk || !toOk) {
        return { success: false, message: 'Both parties must be in the conversation' };
      }

      // Pull sender info so the receiver's incoming-call UI has a name + avatar
      // immediately, without an extra round trip.
      const sender = await db.get(
        `SELECT full_name, profile_picture_path FROM users WHERE id = ?`,
        [fromUserId]
      );

      const event = `call:${type}`;
      const signalPayload = {
        fromUserId,
        toUserId,
        conversationId,
        type,
        payload: payload || null,
        senderName: sender ? sender.full_name : 'Unknown',
        senderPicture: sender ? sender.profile_picture_path : null,
        sentAt: new Date().toISOString()
      };
      broadcast(toUserId, event, signalPayload);

      // For end-of-call events, persist a short marker message so the chat
      // history reflects that a call took place. Skip ICE/offer/answer — those
      // are noisy and not user-facing.
      if (type === 'hangup' || type === 'reject') {
        const markerText = type === 'reject'
          ? '📞 Call declined'
          : (payload && payload.missed ? '📞 Missed call' : '📞 Call ended');
        const id = uuidv4();
        const sentAt = signalPayload.sentAt;
        await db.run(
          `INSERT INTO chat_messages (id, conversation_id, sender_id, content, sent_at)
           VALUES (?, ?, ?, ?, ?)`,
          [id, conversationId, fromUserId, markerText, sentAt]
        );
        await db.run(
          `UPDATE chat_conversations SET last_message_at = ? WHERE id = ?`,
          [sentAt, conversationId]
        );
        // Tell both ends to refresh their conversation list / unread badge.
        const messagePayload = {
          id,
          conversationId,
          senderId: fromUserId,
          senderName: signalPayload.senderName,
          senderPicture: signalPayload.senderPicture,
          content: markerText,
          sentAt,
          attachmentPath: null, attachmentName: null, attachmentSize: null, attachmentMime: null
        };
        broadcast(toUserId, 'message:new', messagePayload);
        broadcast(fromUserId, 'message:new', messagePayload);

        await writeAudit(db, fromUserId, {
          action: type === 'reject' ? 'CALL_REJECTED' : 'CALL_ENDED',
          entityType: 'CHAT_CALL',
          entityId: conversationId,
          oldValue: null,
          newValue: { to: toUserId, missed: !!(payload && payload.missed) }
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[CHAT] call:signal error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // v4.5 — Presence snapshot. Combines the live SSE subscriber map (who's
  // actually got the app open) with today's attendance + time_log rows so
  // the dot accurately reflects "is this person reachable / working right
  // now?". Returns one row per requested userId so the renderer can render
  // a dot without N round-trips.
  ipcMain.handle('chat:getPresence', async (_event, { userIds } = {}) => {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return { success: true, data: [] };
      }
      const officeTime = require('../../utils/officeTime');
      const today = officeTime.getOfficeDate();
      // One query for both joins keyed by user id.
      const placeholders = userIds.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT u.id            AS user_id,
                a.status        AS attendance_status,
                a.sign_in_time, a.sign_out_time,
                t.start_time, t.break_start_time, t.break_end_time, t.end_time
           FROM users u
           LEFT JOIN attendance  a ON a.user_id = u.id AND a.date = ?
           LEFT JOIN time_logs   t ON t.user_id = u.id AND t.date = ?
          WHERE u.id IN (${placeholders})`,
        [today, today, ...userIds]
      );

      const data = rows.map(r => {
        const s = (r.attendance_status || '').toLowerCase();
        const isOnline = _subscribers.has(r.user_id);
        let status = 'offline';
        if (s === 'absent')       status = 'absent';
        else if (s === 'leave')   status = 'on-leave';
        else if (r.end_time)      status = 'signed-off';
        else if (r.break_start_time && !r.break_end_time) status = 'on-break';
        else if (r.start_time || r.sign_in_time) status = 'working';
        else if (isOnline)        status = 'idle';      // signed in to the app but not yet stamped sign-in
        return { userId: r.user_id, status, isOnline };
      });
      return { success: true, data };
    } catch (error) {
      console.error('[CHAT] getPresence error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Read a chat attachment's bytes as base64 so the renderer can embed it
  // (typically as a data URL for inline image previews). Validates that the
  // path lives under the canonical attachments directory — refuses to read
  // anything outside it, so a malicious payload can't exfiltrate, say,
  // /etc/passwd by passing a relative path.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:readAttachment', async (_event, attachmentPath) => {
    try {
      if (!attachmentPath || typeof attachmentPath !== 'string') {
        return { success: false, message: 'attachmentPath is required' };
      }
      const dir = attachmentsDir();
      const resolved = path.resolve(attachmentPath);
      if (!resolved.startsWith(path.resolve(dir))) {
        return { success: false, message: 'Path outside attachments directory' };
      }
      if (!fs.existsSync(resolved)) return { success: false, message: 'File not found' };
      const buf = fs.readFileSync(resolved);
      return { success: true, data: { base64: buf.toString('base64') } };
    } catch (error) {
      console.error('[CHAT] readAttachment error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // Open a chat attachment in the OS's default application. Same path-jail
  // check as readAttachment.
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:openAttachment', async (_event, attachmentPath) => {
    try {
      if (!attachmentPath || typeof attachmentPath !== 'string') {
        return { success: false, message: 'attachmentPath is required' };
      }
      const dir = attachmentsDir();
      const resolved = path.resolve(attachmentPath);
      if (!resolved.startsWith(path.resolve(dir))) {
        return { success: false, message: 'Path outside attachments directory' };
      }
      if (!fs.existsSync(resolved)) return { success: false, message: 'File not found' };
      const err = await shell.openPath(resolved);
      if (err) return { success: false, message: err };
      return { success: true };
    } catch (error) {
      console.error('[CHAT] openAttachment error:', error);
      return { success: false, message: error.message };
    }
  });

  // -------------------------------------------------------------------------
  // v4.6 — Broadcast: send a single message body to many recipients in one
  // call. Recipient picker formats supported:
  //   { all: true }                        → every active user except sender
  //   { departmentIds: ['dept-1', ...] }   → all active users in those depts
  //   { roleNames:    ['Lead', 'Admin'] }  → all active users with those roles
  //   { userIds:      ['u1', 'u2', ...] }  → exactly these IDs
  //   { excludeIds:   ['u3'] }             → applied on top of the above
  //
  // Behaviour:
  //   - Fans out one 1:1 conversation per recipient (creating if needed).
  //   - Posts the same message into each conversation.
  //   - Returns counts: { delivered, failed, recipientCount }
  // -------------------------------------------------------------------------
  ipcMain.handle('chat:broadcast', async (_event, { userId, recipients, content, attachment } = {}) => {
    try {
      if (!userId) return { success: false, message: 'userId required' };
      const trimmed = String(content || '').trim();
      if (!trimmed && !attachment) {
        return { success: false, message: 'Message cannot be empty' };
      }
      if (trimmed.length > 4000) {
        return { success: false, message: 'Message is too long (max 4000 chars)' };
      }
      const spec = recipients || {};

      // Resolve the recipient list.
      const targetIds = new Set();
      const exclude = new Set([userId, ...((spec.excludeIds || []))]);

      if (spec.all) {
        const rows = await db.all(`SELECT id FROM users WHERE status = 'active'`);
        rows.forEach(r => targetIds.add(r.id));
      } else {
        if (Array.isArray(spec.userIds) && spec.userIds.length > 0) {
          spec.userIds.forEach(id => targetIds.add(id));
        }
        if (Array.isArray(spec.departmentIds) && spec.departmentIds.length > 0) {
          const qs = spec.departmentIds.map(() => '?').join(',');
          const rows = await db.all(
            `SELECT id FROM users WHERE status = 'active' AND department_id IN (${qs})`,
            spec.departmentIds
          );
          rows.forEach(r => targetIds.add(r.id));
        }
        if (Array.isArray(spec.roleNames) && spec.roleNames.length > 0) {
          const qs = spec.roleNames.map(() => '?').join(',');
          const rows = await db.all(
            `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.status = 'active' AND r.name IN (${qs})`,
            spec.roleNames
          );
          rows.forEach(r => targetIds.add(r.id));
        }
      }
      // Drop the sender + any explicit excludes.
      exclude.forEach(id => targetIds.delete(id));

      const ids = Array.from(targetIds);
      if (ids.length === 0) {
        return { success: false, message: 'No recipients matched' };
      }

      // Persist the attachment to disk ONCE; we'll reuse the same row for
      // every recipient so storage stays linear in attachment count, not
      // recipient count.
      let attachmentRow = null;
      if (attachment) {
        try {
          if (!attachment.base64 || !attachment.name) {
            return { success: false, message: 'Attachment is missing data' };
          }
          const buf = Buffer.from(attachment.base64, 'base64');
          if (buf.length > MAX_ATTACHMENT_BYTES) {
            return { success: false, message: 'Attachment too large (max 10 MB)' };
          }
          const fileId = uuidv4();
          const fullPath = path.join(attachmentsDir(), `${fileId}${safeExt(attachment.name)}`);
          fs.writeFileSync(fullPath, buf);
          attachmentRow = {
            path: fullPath,
            name: String(attachment.name).slice(0, 255),
            size: buf.length,
            mime: String(attachment.mime || 'application/octet-stream').slice(0, 255)
          };
        } catch (e) {
          console.error('[CHAT] broadcast attachment write failed:', e);
          return { success: false, message: 'Could not save attachment: ' + e.message };
        }
      }

      // Sender info for the SSE payload.
      const sender = await db.get(
        `SELECT full_name, profile_picture_path FROM users WHERE id = ?`,
        [userId]
      );

      let delivered = 0, failed = 0;

      for (const otherId of ids) {
        try {
          // Get or create the 1:1 conversation.
          let conv = await db.get(
            `SELECT c.id
               FROM chat_conversations c
               JOIN chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
               JOIN chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
              WHERE c.type = 'direct' LIMIT 1`,
            [userId, otherId]
          );
          let conversationId;
          if (conv) {
            conversationId = conv.id;
          } else {
            conversationId = uuidv4();
            await db.run(`INSERT INTO chat_conversations (id, type) VALUES (?, 'direct')`, [conversationId]);
            await db.run(`INSERT INTO chat_participants (id, conversation_id, user_id) VALUES (?, ?, ?)`, [uuidv4(), conversationId, userId]);
            await db.run(`INSERT INTO chat_participants (id, conversation_id, user_id) VALUES (?, ?, ?)`, [uuidv4(), conversationId, otherId]);
            broadcast(otherId, 'conversation:new', { conversationId, by: userId });
          }

          const msgId = uuidv4();
          const sentAt = new Date().toISOString();
          await db.run(
            `INSERT INTO chat_messages (id, conversation_id, sender_id, content, sent_at,
                                        attachment_path, attachment_name, attachment_size, attachment_mime)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              msgId, conversationId, userId, trimmed, sentAt,
              attachmentRow?.path || null,
              attachmentRow?.name || null,
              attachmentRow?.size || null,
              attachmentRow?.mime || null
            ]
          );
          await db.run(
            `UPDATE chat_conversations SET last_message_at = ? WHERE id = ?`,
            [sentAt, conversationId]
          );

          const payload = {
            id: msgId,
            conversationId,
            senderId: userId,
            senderName: sender ? sender.full_name : 'Unknown',
            senderPicture: sender ? sender.profile_picture_path : null,
            content: trimmed,
            sentAt,
            attachmentPath: attachmentRow?.path || null,
            attachmentName: attachmentRow?.name || null,
            attachmentSize: attachmentRow?.size || null,
            attachmentMime: attachmentRow?.mime || null,
            isBroadcast: true
          };
          broadcast(otherId, 'message:new', payload);
          delivered++;
        } catch (e) {
          console.error(`[CHAT] broadcast → ${otherId} failed:`, e.message);
          failed++;
        }
      }

      // One audit row for the whole broadcast — no per-recipient body stored.
      try {
        await writeAudit(db, userId, {
          action: 'CHAT_BROADCAST',
          entityType: 'CHAT_BROADCAST',
          entityId: `${userId}-${Date.now()}`,
          oldValue: null,
          newValue: { recipientCount: ids.length, delivered, failed, hadAttachment: !!attachmentRow, contentLength: trimmed.length }
        });
      } catch (_) {}

      return { success: true, delivered, failed, recipientCount: ids.length };
    } catch (error) {
      console.error('[CHAT] broadcast error:', error);
      return { success: false, message: error.message };
    }
  });
}

module.exports = { register, addSubscriber, removeSubscriber, broadcast };
