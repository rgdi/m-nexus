// lazySearchService.ts: SearchService wrapper lazy.
// v0.48: SearchService (better-sqlite3) cuelga si better-sqlite3 no carga.
// Este wrapper retrasa la creación y devuelve [] si falla.
//
// PATRÓN: usar en vez de new SearchService() cuando el SearchService
// solo se necesita como fallback (el flujo principal usa contexto del cliente).
import { SearchService, type SearchResult, type SearchOptions } from "./searchService.js";

export class LazySearchService {
  private _svc: SearchService | null = null;
  private _failed = false;

  private get svc(): SearchService {
    if (this._failed) throw new Error("SearchService unavailable");
    if (!this._svc) {
      try {
        this._svc = new SearchService();
      } catch (e) {
        this._failed = true;
        throw e; // propagate so caller knows it's unavailable
      }
    }
    return this._svc;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    try {
      return await this.svc.search(query, options);
    } catch (e) {
      this._failed = true;
      this._svc = null;
      return []; // fallback: empty results
    }
  }
}
