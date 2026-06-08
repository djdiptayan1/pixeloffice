// ---------------------------------------------------------------------------
// Maps REST API (mounted at /api/maps). Plain Express router.
//
// Map Studio (Phase 2) uses these to list / load / save / activate buildings.
// Reads are open; WRITES (save + activate) are guarded by the SAME admin guard
// pattern as admin.routes.ts (createAdminGuard): a no-op in dev, requireRole
// ('admin') when AUTH_REQUIRED=true.
//
// Validation is HARD: POST bodies go through parseBuilding(), which throws a
// BuildingParseError listing every geometry problem -> 400 with the error list.
// The services/repository stay framework- and auth-agnostic.
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from "express";
import { BuildingParseError } from "@pixeloffice/shared";
import { container } from "../container";
import { createAdminGuard } from "../auth/middleware";
import { createLogger } from "../logging/logger";

const log = createLogger("maps");

export function createMapsRouter(): Router {
  const router = Router();

  const guard = createAdminGuard(
    container.authConfig.jwt,
    container.authConfig.authRequired,
  );

  // GET /api/maps — list stored maps (id/name/active) -----------------------
  router.get("/", (_req: Request, res: Response) => {
    res.json({ maps: container.maps.listMaps(), activeId: container.maps.getActiveId() });
  });

  // GET /api/maps/active — the active building (full geometry) ---------------
  // Registered BEFORE "/:id" so "active" is never treated as an id.
  router.get("/active", (_req: Request, res: Response) => {
    const id = container.maps.getActiveId();
    const building = container.maps.getMap(id);
    if (!building) {
      res.status(404).json({ error: "No active map" });
      return;
    }
    res.json({ building });
  });

  // GET /api/maps/:id — one stored building (full geometry) ------------------
  router.get("/:id", (req: Request, res: Response) => {
    const building = container.maps.getMap(req.params.id);
    if (!building) {
      res.status(404).json({ error: "Map not found" });
      return;
    }
    res.json({ building });
  });

  // POST /api/maps — validate + save a building (Map Studio save) ------------
  router.post("/", guard, (req: Request, res: Response) => {
    try {
      const building = container.maps.saveMap(req.body);
      log.info("map saved", { id: building.id, floors: building.floors.length });
      res.status(201).json({
        id: building.id,
        name: building.name,
        floors: building.floors.map((f) => ({ id: f.id, name: f.name, index: f.index })),
      });
    } catch (err) {
      if (err instanceof BuildingParseError) {
        res.status(400).json({ error: "Invalid building geometry", details: err.errors });
        return;
      }
      throw err;
    }
  });

  // POST /api/maps/:id/activate — make a stored map the active one -----------
  router.post("/:id/activate", guard, (req: Request, res: Response) => {
    const ok = container.maps.setActive(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Map not found" });
      return;
    }
    log.info("map activated", { id: req.params.id });
    // NOTE: applies to NEW joins/rooms; live players keep their session.
    res.status(200).json({ ok: true, activeId: container.maps.getActiveId() });
  });

  return router;
}
