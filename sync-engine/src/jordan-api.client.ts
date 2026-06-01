export interface JordanApiConfig {
  baseUrl: string;
  username: string;
  password: string;
  company: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export class JordanApiClient {
  private token: string | null = null;

  constructor(private readonly config: JordanApiConfig) {}

  async authenticate(): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      username: this.config.username,
      password: this.config.password,
    });
    const url = `${baseUrl}/api/Auth/Apilogin?${params.toString()}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jordan API login failed (${res.status}): ${body}`);
    }

    this.token = (await res.text()).trim();
    if (!this.token) {
      throw new Error("Jordan API returned empty token");
    }
    return this.token;
  }

  private async headers(): Promise<HeadersInit> {
    if (!this.token) await this.authenticate();
    return {
      Authorization: `Bearer ${this.token}`,
      company: this.config.company,
      Accept: "application/json",
    };
  }

  async get<T>(path: string): Promise<T> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}${path}`, {
      headers: await this.headers(),
    });

    if (res.status === 401) {
      this.token = null;
      await this.authenticate();
      return this.get<T>(path);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jordan API ${path} failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<T>;
  }

  getServices(pagination?: PaginationParams) {
    const params = pagination ? this.toParams(pagination) : "";
    return this.get<unknown[]>(`/api/Basic/GetServices${params}`);
  }

  getPatients(pagination?: PaginationParams) {
    const params = pagination ? this.toParams(pagination) : "";
    return this.get<unknown[]>(`/api/Patient/GetAll${params}`);
  }

  getReserves(pagination?: PaginationParams) {
    const params = pagination ? this.toParams(pagination) : "";
    return this.get<unknown[]>(`/api/Reserve/GetReserves${params}`);
  }

  getTreatments(pagination?: PaginationParams) {
    const params = pagination ? this.toParams(pagination) : "";
    return this.get<unknown[]>(`/api/Treatment/GetTreatments${params}`);
  }

  private toParams(p: PaginationParams): string {
    const params = new URLSearchParams();
    if (p.page) params.set("pageNumber", String(p.page));
    if (p.pageSize) params.set("pageSize", String(p.pageSize));
    return `?${params.toString()}`;
  }
}
