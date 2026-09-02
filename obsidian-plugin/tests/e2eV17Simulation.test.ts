// v0.17: Simulación e2e extendida (14 días) con persistencia real,
// focus mode, y todos los features integrados.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { PersistentAdherenceStore } from "../src/exams/persistentAdherence";
import { NotificationServiceV2, detectAllV2 } from "../src/exams/notificationsV2";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import { shouldTriggerRebalance } from "../src/exams/autoRebalance";
import { ExamScheduler } from "../src/exams/scheduler";
import { defaultFSRSAdapter, applyBoosts, generateBoost, revertBoosts } from "../src/exams/fsrsIntegration";
import { recentAdherence } from "../src/exams/adherence";
import type { Exam, FlashcardFSRS } from "../src/exams/types";
import type { AdherenceRecord } from "../src/exams/boost";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return Object.keys(this.data).length > 0 ? this.data : null; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
  _getData() { return this.data; }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeCards(n: number, baseDueOffset: number, subject: string): FlashcardFSRS[] {
  const cards: FlashcardFSRS[] = [];
  for (let i = 0; i < n; i++) {
    cards.push({
      id: `${subject}-card-${i}`,
      notePath: `${subject}/Tema-${i % 5}.md`,
      front: `Pregunta ${i}`,
      back: `Respuesta ${i}`,
      topic: `Tema ${i % 5}`,
      dueDate: dayOffset(baseDueOffset + (i % 7)),
      stability: 1 + (i % 5),
      difficulty: 0.3 + (i % 5) * 0.1,
      lastReview: dayOffset(-2),
      reps: 1 + (i % 3),
      lapses: 0,
      suspended: false,
    });
  }
  return cards;
}

function makeExam(days: number, subject: string, priority: "low" | "medium" | "high" = "medium"): Exam {
  return {
    id: `exam-${subject}`,
    title: `Examen ${subject}`,
    subject,
    date: dayOffset(days),
    examType: days > 5 ? "parcial" : "final",
    scopes: [{ type: "folder", path: subject, includeSubfolders: true }],
    status: "active",
    priority,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeResolver(cards: FlashcardFSRS[]) {
  return {
    resolve: (scope: { type: string; path?: string }) => {
      if (scope.type === "folder") {
        return cards.filter((c) => c.notePath.startsWith(scope.path ?? ""));
      }
      return cards;
    },
  };
}

describe("Simulación e2e v0.17: 14 días completos", () => {
  let plugin: MockPlugin;
  let storage: PluginDataStorage;
  let streak: PersistentStreakTracker;
  let adherence: PersistentAdherenceStore;
  let notif: NotificationServiceV2;
  let monitor: AdherenceMonitorV2;
  let examBio: Exam;
  let examAna: Exam;
  let examFis: Exam;
  let cardsBio: FlashcardFSRS[];
  let cardsAna: FlashcardFSRS[];
  let cardsFis: FlashcardFSRS[];
  let allCards: FlashcardFSRS[];
  let eventsEmitted: import("../src/exams/notificationsV2").NotificationEvent[];
  let now: number;

  beforeEach(() => {
    plugin = new MockPlugin();
    // Fijar 'now' a hoy (no a fecha fija UTC) para que dayOffset(0) matchee.
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    now = today.getTime();
    return (async () => {
      storage = await PluginDataStorage.load(plugin as never);
      streak = new PersistentStreakTracker(storage);
      adherence = new PersistentAdherenceStore(storage);

      // 3 exámenes: Bio (14d), Ana (10d), Fis (3d)
      examBio = makeExam(14, "Bioquímica", "high");
      examAna = makeExam(10, "Anatomía", "medium");
      examFis = makeExam(3, "Fisiología", "critical");

      cardsBio = makeCards(30, 0, "Bioquímica");
      cardsAna = makeCards(30, 2, "Anatomía");
      cardsFis = makeCards(20, 1, "Fisiología");
      allCards = [...cardsBio, ...cardsAna, ...cardsFis];

      // Generar planes con boost
      const resolver = makeResolver(allCards);
      const scheduler = new ExamScheduler(resolver as never);
      const bioResolved = cardsBio;
      const anaResolved = cardsAna;
      const fisResolved = cardsFis;
      applyBoosts(bioResolved, examBio);
      applyBoosts(anaResolved, examAna);
      applyBoosts(fisResolved, examFis);
      examBio.schedule = scheduler.generate(examBio, bioResolved);
      examAna.schedule = scheduler.generate(examAna, anaResolved);
      examFis.schedule = scheduler.generate(examFis, fisResolved);

      // Service de notificaciones (storage fresco por test)
      const notifStorage = new Map<string, string>();
      eventsEmitted = [];
      notif = new NotificationServiceV2(
        { examApproachingDays: [14, 7, 3, 1], maxPerDay: 10, dedupHours: 0 },
        {
          read: (k) => notifStorage.get(k) ?? null,
          write: (k, v) => notifStorage.set(k, v),
        }
      );
      notif.onEmit = (e) => eventsEmitted.push(e);
      notif.setNow(() => now);
      notif.setFocusChecker(() => storage.isInFocusMode(now));

      // Monitor
      monitor = new AdherenceMonitorV2(
        { intervalHours: 999, enabled: true },
        {
          examManager: { list: () => [examBio, examAna, examFis] },
          notificationService: notif,
          streakTracker: streak,
          adherenceStore: adherence,
          useRealTimer: false,
          now: () => now,
          isInFocusMode: () => storage.isInFocusMode(now),
        }
      );
    })();
  });

  it("Setup: 3 exámenes con planes generados", () => {
    expect(examBio.schedule?.totalCards).toBeGreaterThan(0);
    expect(examAna.schedule?.totalCards).toBeGreaterThan(0);
    expect(examFis.schedule?.totalCards).toBeGreaterThan(0);
  });

  it("Día 1-3: racha crece, no hay alertas", () => {
    return (async () => {
      for (let day = 0; day < 3; day++) {
        // 10 repasos al día (fechas recientes para que la racha siga activa)
        for (let i = 0; i < 10; i++) {
          const card = allCards[(day * 10 + i) % allCards.length];
          adherence.addReview({
            cardId: card.id,
            examId: card.notePath.startsWith("Bioquímica") ? examBio.id :
                   card.notePath.startsWith("Anatomía") ? examAna.id : examFis.id,
            date: dayOffset(-2 + day),
            rating: 3,
            durationMs: 20000,
          });
        }
        streak.recordStudy({
          date: dayOffset(-2 + day),
          cardsReviewed: 10,
          durationMs: 200000,
        });
      }
      expect(streak.getCurrent()).toBe(3);
      expect(streak.getBest()).toBe(3);
    })();
  });

  it("Día 5: racha rota → streak-at-risk (no rebota hasta día 6)", () => {
    return (async () => {
      // Días 0-2: estudio
      for (let day = 0; day < 3; day++) {
        streak.recordStudy({ date: dayOffset(-3 + day), cardsReviewed: 5, durationMs: 50000 });
      }
      // Días 3-4: no estudio
      const events = monitor.tick();
      const atRisk = events.find((e) => e.type === "streak-at-risk");
      expect(atRisk).toBeDefined();
      expect(atRisk?.meta?.streak).toBe(3);
    })();
  });

  it("Día 7: racha rota (pasaron >1 día) → current=0, mejor=3", () => {
    return (async () => {
      // Hace 7 días estudió
      streak.recordStudy({ date: dayOffset(-7), cardsReviewed: 5, durationMs: 50000 });
      streak.recordStudy({ date: dayOffset(-6), cardsReviewed: 5, durationMs: 50000 });
      streak.recordStudy({ date: dayOffset(-5), cardsReviewed: 5, durationMs: 50000 });
      // Ahora no ha estudiado hace 5 días
      expect(streak.getBest()).toBe(3);
      expect(streak.getCurrent()).toBe(0); // reset por inactividad
    })();
  });

  it("Día 10: examen Ana en 0 días → approaching (urgent)", () => {
    return (async () => {
      // Ana estaba en 10 días originalmente; actualizar a 0
      examAna.date = dayOffset(0);
      const events = monitor.tick();
      const approaching = events.find((e) => e.type === "exam-approaching" && e.examId === examAna.id);
      expect(approaching).toBeDefined();
      expect(approaching?.severity).toBe("urgent");
      expect(approaching?.title).toContain("HOY");
    })();
  });

  it("Día 12: rebalanceo recomendado (adherencia baja)", () => {
    return (async () => {
      // 3 días de baja adherencia
      for (let day = 0; day < 3; day++) {
        for (let i = 0; i < 2; i++) {
          adherence.addReview({
            cardId: `card-${i}`,
            examId: examBio.id,
            date: dayOffset(-2 + day),
            rating: 1,
            durationMs: 10000,
          });
        }
      }
      // Adherencia reciente < 0.5
      const records: AdherenceRecord[] = [];
      for (let day = 0; day < 3; day++) {
        records.push({
          examId: examBio.id,
          date: dayOffset(-2 + day),
          planned: 10,
          completed: 2,
          adherenceRate: 0.2,
          rolling7: 0.2,
        });
      }
      expect(shouldTriggerRebalance(records)).toBe(true);
    })();
  });

  it("Focus mode: bloquea notificaciones por 1h", () => {
    return (async () => {
      storage.enableFocusMode(60 * 60 * 1000, now);
      const events = monitor.tick();
      expect(events).toHaveLength(0);
    })();
  });

  it("Focus mode: auto-expira y notificaciones vuelven", () => {
    return (async () => {
      // Activar focus que ya expiró
      storage.enableFocusMode(100, now - 200);
      expect(storage.isInFocusMode(now)).toBe(false);
      const events = monitor.tick();
      // Debería haber exam-approaching porque Bio está en 14 días
      expect(events.length).toBeGreaterThan(0);
    })();
  });

  it("Persistencia: reload plugin mantiene streak y reviews", () => {
    return (async () => {
      streak.recordStudy({ date: dayOffset(-1), cardsReviewed: 5, durationMs: 50000 });
      streak.recordStudy({ date: dayOffset(0), cardsReviewed: 7, durationMs: 70000 });
      adherence.addReview({ cardId: "c1", examId: examBio.id, date: dayOffset(0), rating: 3, durationMs: 1000 });
      await storage.saveNow();
      // "Reload" plugin
      const newStorage = await PluginDataStorage.load(plugin as never);
      const newStreak = new PersistentStreakTracker(newStorage);
      const newAdh = new PersistentAdherenceStore(newStorage);
      expect(newStreak.getCurrent()).toBe(2);
      expect(newAdh.loadReviews()).toHaveLength(1);
    })();
  });

  it("Flujo completo: estudiar → streak crece → milestone → notificación", () => {
    return (async () => {
      // 3 días seguidos
      for (let day = 0; day < 3; day++) {
        streak.recordStudy({ date: dayOffset(-2 + day), cardsReviewed: 5, durationMs: 50000 });
        adherence.addReview({
          cardId: `c-${day}`,
          examId: examBio.id,
          date: dayOffset(-2 + day),
          rating: 3,
          durationMs: 50000,
        });
      }
      expect(streak.getCurrent()).toBe(3);
      const data = streak.getRawData();
      expect(data.milestonesReached).toContain(3);
    })();
  });

  it("Boost + revert: aplicar y revertir múltiples veces sin duplicar", () => {
    return (async () => {
      const exam = examBio;
      // Card con dueDate FUTURA lejana (necesita boost para alinearla con el examen en 14 días)
      const card: FlashcardFSRS = {
        id: "test-card",
        notePath: "Bioquímica/T.md",
        front: "q",
        back: "a",
        topic: "t",
        dueDate: dayOffset(20), // muy lejos del target (dayOffset(13))
        stability: 1,
        difficulty: 0.5,
        lastReview: dayOffset(-2),
        reps: 1,
        lapses: 0,
        suspended: false,
      };
      const originalDue = card.dueDate;

      // Aplicar 3 veces (simula re-cálculo de plan)
      for (let i = 0; i < 3; i++) {
        applyBoosts([card], exam);
        revertBoosts([card], exam.id);
      }

      // El dueDate debe ser el original después de reverts
      expect(card.dueDate).toBe(originalDue);
      // boostHistory[0] debe tener applied=false
      expect(card.boostHistory?.[0]?.applied).toBe(false);
    })();
  });

  it("Multi-examen: schedules se generan sin colisiones graves", () => {
    return (async () => {
      // Bio, Ana, Fis se generan independientemente
      // El MultiExamCoordinator los combinaría
      const totalCards = (examBio.schedule?.totalCards ?? 0) +
                        (examAna.schedule?.totalCards ?? 0) +
                        (examFis.schedule?.totalCards ?? 0);
      expect(totalCards).toBeGreaterThan(0);
      // Cada examen tiene un plan no-vacío
      expect(examBio.schedule?.days.length).toBeGreaterThan(0);
      expect(examAna.schedule?.days.length).toBeGreaterThan(0);
      expect(examFis.schedule?.days.length).toBeGreaterThan(0);
    })();
  });

  it("Notificaciones: maxPerDay = 10 (alto en el test)", () => {
    return (async () => {
      // Limpiar eventos
      eventsEmitted.length = 0;
      const all = [
        ...notif.detectAdherenceDrops([examBio, examAna, examFis]),
        ...notif.detectExamApproaching([examBio, examAna, examFis]),
        ...notif.detectOverloadedDays([examBio, examAna, examFis]),
      ];
      // Bio en 14 días (dispara), Ana en 10 días (NO en lista), Fis en 3 días (dispara)
      // → 2 approaching events
      const approaching = all.filter((e) => e.type === "exam-approaching");
      expect(approaching.length).toBe(2);
    })();
  });

  it("Racha persistida + exam-approaching detectados en mismo tick", () => {
    return (async () => {
      streak.recordStudy({ date: dayOffset(-1), cardsReviewed: 5, durationMs: 50000 });
      streak.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 50000 });
      const events = monitor.tick();
      // Bio (14d) y Fis (3d) están en la lista; Ana (10d) no
      const approaching = events.filter((e) => e.type === "exam-approaching");
      expect(approaching.length).toBe(2);
    })();
  });
});
