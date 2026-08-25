import { create } from "zustand";
import { apiFetch } from "@/lib/api-client";

export interface UserInfo {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  permissions: string[];
  lastLoginAt?: string | null;
}

interface AuthState {
  user: UserInfo | null;
  isLoaded: boolean;
  load: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

/**
 * The session token is no longer held in JS at all — it lives in an httpOnly
 * cookie, so there is nothing here for an XSS payload to steal. `/api/auth/me`
 * is the only way to learn whether the cookie is still valid, which is why load
 * always calls it instead of trusting a cached copy.
 */
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  isLoaded: false,

  load: () => {
    if (typeof window === "undefined") return;
    apiFetch<UserInfo>("/api/auth/me")
      .then((user) => {
        set({ user, isLoaded: true });
      })
      .catch(() => {
        set({ user: null, isLoaded: true });
      });
  },

  login: async (email: string, password: string) => {
    // The response carries the CSRF token and the user; the session itself
    // arrives as a Set-Cookie the browser stores for us.
    const data = await apiFetch<{ csrfToken: string; user: UserInfo }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    set({ user: data.user, isLoaded: true });
  },

  logout: async () => {
    // Server-side logout bumps the user's token version, so any copy of the
    // token that leaked elsewhere stops working too.
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    set({ user: null });
    if (typeof window !== "undefined") {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
  },

  hasPermission: (perm: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.permissions.includes("*")) return true;
    return user.permissions.includes(perm);
  },
}));
