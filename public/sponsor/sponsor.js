"use strict";

const toast = document.querySelector("#copy-toast");
let toastTimer = null;

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy_failed");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

document.querySelectorAll(".copy-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const address = document.getElementById(button.dataset.copy)?.textContent?.trim();
    if (!address) return;

    try {
      await copyText(address);
      const original = button.textContent;
      button.textContent = "已复制";
      button.classList.add("copied");
      showToast("地址已复制，请在转账前再次核对");
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove("copied");
      }, 1800);
    } catch {
      showToast("复制失败，请手动选择地址");
    }
  });
});
