const form = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const errorElement = document.getElementById("login-error");

function getNextLocation() {
  const url = new URL(window.location.href);
  const next = url.searchParams.get("next");
  if (!next || !next.startsWith("/")) {
    return "/";
  }

  return next;
}

function showError(message) {
  errorElement.hidden = false;
  errorElement.textContent = message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.hidden = true;

  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: passwordInput.value,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      showError(payload?.error || "Login failed");
      passwordInput.select();
      return;
    }

    window.location.assign(getNextLocation());
  } catch (error) {
    console.error("Login failed", error);
    showError("Login request failed");
  }
});
