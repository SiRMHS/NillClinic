const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new Error("نشست منقضی شده است. لطفاً مجدداً وارد شوید");
  }

  if (!response.ok) {
    let errorMessage = `خطا در برقراری ارتباط با سرور: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.error) {
        errorMessage = errBody.error;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}
