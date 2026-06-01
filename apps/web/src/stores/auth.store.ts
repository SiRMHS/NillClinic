import { create } from "zustand";
import { apiFetch } from "@/lib/api-client";

export interface UserInfo {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  permissions: string[];
}

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  isLoaded: boolean;
  load: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoaded: false,

  load: () => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("token");
    if (!token) {
      set({ isLoaded: true });
      return;
    }
    apiFetch<UserInfo>("/api/auth/me")
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user));
        set({ user, token, isLoaded: true });
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        set({ isLoaded: true });
      });
  },

  login: async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: UserInfo }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ user: data.user, token: data.token });
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null, token: null });
    if (typeof window !== "undefined") {
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
