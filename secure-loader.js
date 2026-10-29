(() => {
  "use strict";

  const form = document.getElementById("unlockForm");
  const input = document.getElementById("unlockPassword");
  const button = document.getElementById("unlockBtn");
  const error = document.getElementById("unlockError");
  const status = document.getElementById("unlockStatus");
  const lock = document.getElementById("lockScreen");

  function b64Bytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  function fail(message) {
    error.textContent = message;
    button.disabled = false;
    button.textContent = "进入卡册";
    input.focus();
  }

  async function unlock(event) {
    event.preventDefault();
    let password = input.value.trim();
    if (!password) {
      fail("先输入班级口令。");
      return;
    }
    if (!crypto.subtle) {
      fail("当前页面不是 HTTPS，浏览器拒绝了加密接口。");
      return;
    }
    error.textContent = "";
    button.disabled = true;
    button.textContent = "正在解封…";
    status.textContent = "读取加密卡册…";
    try {
      const response = await fetch("secure/payload.json", { cache: "no-store" });
      if (!response.ok) throw new Error("找不到加密卡册文件。");
      const envelope = await response.json();
      const chunkPaths = Array.isArray(envelope.chunks) ? envelope.chunks : [];
      if (!chunkPaths.length) throw new Error("加密卡册没有分块信息。");
      status.textContent = `读取加密卡册（${chunkPaths.length} 块）…`;
      const version = envelope.version || "";
      const chunkBuffers = new Array(chunkPaths.length);
      async function readChunk(path, index) {
        const url = version
          ? `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
          : path;
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const chunkResponse = await fetch(url, { cache: "no-store" });
            if (!chunkResponse.ok) throw new Error(`HTTP ${chunkResponse.status}`);
            chunkBuffers[index] = new Uint8Array(await chunkResponse.arrayBuffer());
            return;
          } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
        throw new Error(`加密卡册分块读取失败：${lastError || ""}`);
      }
      for (let start = 0; start < chunkPaths.length; start += 4) {
        const slice = chunkPaths.slice(start, start + 4);
        await Promise.all(slice.map((path, offset) => readChunk(path, start + offset)));
        status.textContent = `读取加密卡册 ${Math.min(start + 4, chunkPaths.length)} / ${chunkPaths.length}…`;
      }
      const total = chunkBuffers.reduce((sum, chunk) => sum + chunk.length, 0);
      const cipher = new Uint8Array(total);
      let offset = 0;
      chunkBuffers.forEach((chunk) => {
        cipher.set(chunk, offset);
        offset += chunk.length;
      });
      status.textContent = "校验口令…";
      const candidates = [password];
      const formula = password.match(/^leyianju(\d{8})(\d+)$/);
      if (formula && formula[2] !== "267") {
        candidates.push(`leyianju${formula[1]}267`);
      }
      let plain = null;
      for (const candidate of candidates) {
        const keyPassword = envelope.day ? `${candidate}|${envelope.day}` : candidate;
        const key = await deriveKey(keyPassword, b64Bytes(envelope.salt), Number(envelope.iter));
        try {
          plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: b64Bytes(envelope.iv) },
            key,
            cipher
          );
          break;
        } catch (_) {
          plain = null;
        }
      }
      if (!plain) throw new Error("bad password");
      const payload = JSON.parse(new TextDecoder().decode(plain));
      window.SANGUOSHA_DATA = payload.data;
      window.SANGUOSHA_ASSETS = payload.assets || {};
      window.SANGUOSHA_READONLY = true;
      document.documentElement.dataset.readonly = "true";
      const badge = document.getElementById("readonlyBadge");
      if (badge) badge.hidden = false;
      status.textContent = "正在布置卡册…";
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `app.js?v=${encodeURIComponent(envelope.version || "")}`;
        script.onload = resolve;
        script.onerror = () => reject(new Error("卡册脚本加载失败。"));
        document.body.appendChild(script);
      });
      lock.classList.add("is-unlocked");
      setTimeout(() => lock.remove(), 450);
    } catch (err) {
      status.textContent = "";
      const message = String(err && err.message || "");
      if (message.includes("分块读取") || message.includes("Failed to fetch") || message.includes("NetworkError")) {
        fail("卡册读取失败，请检查网络后刷新重试。");
      } else {
        fail("口令不对，或者卡册文件损坏。");
      }
    }
  }

  form.addEventListener("submit", unlock);
  setTimeout(() => input.focus(), 250);
})();
