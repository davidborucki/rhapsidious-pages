(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VoxxlyPlaybackQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Exact backend docs/playback contract, opt-in only. No legacy fallback here.
  class Queue {
    constructor(request, sessionId, uuid, now) {
      this.request = request;
      this.sessionId = sessionId;
      this.uuid = uuid;
      this.now = now || Date.now;
      this.cursor = null;
      this.pendingReserve = null;
      this.acks = new Map();
      this.closed = false;
      this.retryAt = 0;
      this.controller = new AbortController();
    }
    async post(path, body) {
      if (this.closed) throw new Error("Playback session ended");
      if (this.now() < this.retryAt) throw new Error("Playback queue is rate limited. Please retry shortly.");
      let result;
      try { result = await this.request(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: this.controller.signal, cache: "no-store"
      }); } catch (error) {
        if (error.status === 429) this.retryAt = this.now() + Math.max(1000, error.retryAfterMs || 1000);
        throw error;
      }
      if (this.closed) throw new Error("Playback session ended");
      return result;
    }
    async reserve() {
      if (!this.pendingReserve) this.pendingReserve = { requestId: this.uuid(), sessionId: this.sessionId, cursor: this.cursor };
      let batch;
      try { batch = await this.post("/iosclips/queue/v2/reserve", this.pendingReserve); }
      catch (error) {
        if (error.status === 409) {
          // Reconnect once; a network retry otherwise keeps the exact requestId/body.
          this.cursor = null;
          this.pendingReserve = { requestId: this.uuid(), sessionId: this.sessionId, cursor: null };
          batch = await this.post("/iosclips/queue/v2/reserve", this.pendingReserve);
        } else throw error;
      }
      if (!batch || batch.version !== 2 || !Array.isArray(batch.items) || batch.items.length > 3 ||
          !batch.cycleId || !batch.nextCursor || !["EMPTY", "RESERVED"].includes(batch.status)) throw new Error("Unexpected playback queue response");
      const ids = new Set();
      const reservations = new Set();
      const items = batch.items.filter(item => {
        if (!item || !item.reservationId || !item.clip || item.clip.id == null || !Number.isFinite(item.expiresAtEpochMs) || item.expiresAtEpochMs <= this.now()) return false;
        if (reservations.has(item.reservationId) || ids.has(String(item.clip.id))) return false;
        reservations.add(item.reservationId);
        ids.add(String(item.clip.id));
        return true;
      }).map(item => ({ ...item.clip, _reservation: { id: item.reservationId, cycleId: batch.cycleId, expiresAt: item.expiresAtEpochMs } }));
      this.cursor = batch.nextCursor;
      this.pendingReserve = null;
      return items;
    }
    async ack(clip, watchSec, displayed) {
      const reservation = clip && clip._reservation;
      if (!reservation || !displayed) return false;
      let receipt = this.acks.get(reservation.id);
      if (!receipt) {
        receipt = { body: {
          eventId: this.uuid(), reservationId: reservation.id, cycleId: reservation.cycleId,
          sessionId: this.sessionId, watchSec: Math.max(0, Number(watchSec) || 0), skipped: !(watchSec > 0)
        }, accepted: false, promise: null };
        this.acks.set(reservation.id, receipt);
      }
      if (receipt.accepted) return true;
      if (receipt.promise) return receipt.promise;
      receipt.promise = this.post("/iosclips/queue/v2/ack", receipt.body).then(result => {
        if (!result || !result.accepted) throw new Error("Watch acknowledgment was not accepted");
        receipt.accepted = true;
        // Preserve unresolved receipts; bound successful history.
        if (this.acks.size > 32) for (const [key, old] of this.acks) {
          if (key !== reservation.id && old.accepted) { this.acks.delete(key); break; }
        }
        return true;
      }).finally(() => { receipt.promise = null; });
      return receipt.promise;
    }
    destroy() {
      this.closed = true;
      this.controller.abort();
      this.acks.clear();
      this.pendingReserve = null;
    }
  }
  return { Queue };
});
