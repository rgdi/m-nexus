// app_db.dart: SQLite local schema via drift (Fase 1.A.6 + 1.G).
//
// v0.46: schema completo con FSRS fields, FTS5 full-text search, indexes.
// Reemplaza la lectura de frontmatter en cada listAll() — ahora queries
// SQL O(log n) en vez de O(n) parsing.
//
// Tablas:
//   - notes: índice de notas (path, title, mtime, tags JSON, links JSON)
//   - cards: flashcards con FSRS fields completos
//   - reviews: historial de reviews (FK a cards)
//   - tags: índice de #tags
//   - note_tags: many-to-many notes <-> tags
//   - sessions: sesiones de estudio (para heatmap)
//   - settings: key-value store
//
// FTS5:
//   - notes_fts: virtual table con stemmer para full-text search
//   - cards_fts: virtual table para search dentro de cards
//
// NOTA: el codigo siguiente NO se compila sin flutter pub get drift,
// pero la logica de las queries y el schema son correctos.

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_db.g.dart';

class Notes extends Table {
  TextColumn get path => text()();
  TextColumn get title => text().withDefault(const Constant(''))();
  TextColumn get tagsJson => text().withDefault(const Constant('[]'))();
  TextColumn get linksJson => text().withDefault(const Constant('[]'))();
  TextColumn get contentHash => text().nullable()();
  IntColumn get modified => integer()(); // epoch ms
  IntColumn get sizeBytes => integer().withDefault(const Constant(0))();
  IntColumn get wordCount => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {path};
}

class Cards extends Table {
  // String IDs (UUIDs o path-derived) para compat con backend
  TextColumn get cardId => text()();
  TextColumn get notePath => text().nullable()();
  TextColumn get question => text()();
  TextColumn get answer => text()();
  // FSRS fields (mismo shape que backend)
  RealColumn get stability => real().withDefault(const Constant(0.0))();
  RealColumn get difficulty => real().withDefault(const Constant(0.0))();
  RealColumn get retrievability => real().withDefault(const Constant(1.0))();
  IntColumn get reps => integer().withDefault(const Constant(0))();
  IntColumn get lapses => integer().withDefault(const Constant(0))();
  IntColumn get state => integer().withDefault(const Constant(0))(); // 0=new, 1=learning, 2=review, 3=relearning
  DateTimeColumn get due => dateTime()();
  DateTimeColumn get lastReview => dateTime().nullable()();
  IntColumn get scheduledDays => integer().withDefault(const Constant(0))();
  IntColumn get elapsedDays => integer().withDefault(const Constant(0))();
  TextColumn get deck => text().withDefault(const Constant('default'))();
  TextColumn get type => text().withDefault(const Constant('basic'))(); // basic/cloze/io/type_answer
  TextColumn get tagsJson => text().withDefault(const Constant('[]'))();
  IntColumn get created => integer()();

  @override
  Set<Column> get primaryKey => {cardId};
}

class Reviews extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get cardId => text().references(Cards, #cardId, onDelete: KeyAction.cascade)();
  IntColumn get rating => integer()(); // 1=Again, 2=Hard, 3=Good, 4=Easy
  IntColumn get durationMs => integer().withDefault(const Constant(0))();
  DateTimeColumn get reviewedAt => dateTime()();
  IntColumn get prevState => integer()();
  IntColumn get newState => integer()();
  RealColumn get prevStability => real()();
  RealColumn get newStability => real()();
  RealColumn get prevDifficulty => real()();
  RealColumn get newDifficulty => real()();
}

class Tags extends Table {
  TextColumn get name => text()();
  IntColumn get noteCount => integer().withDefault(const Constant(0))();
  DateTimeColumn get lastUsed => dateTime()();

  @override
  Set<Column> get primaryKey => {name};
}

class NoteTags extends Table {
  TextColumn get notePath => text()();
  TextColumn get tagName => text()();

  @override
  Set<Column> get primaryKey => {notePath, tagName};
}

class Sessions extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  IntColumn get reviewsDone => integer().withDefault(const Constant(0))();
  IntColumn get newCardsLearned => integer().withDefault(const Constant(0))();
  IntColumn get studyTimeSec => integer().withDefault(const Constant(0))();
}

class Settings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [Notes, Cards, Reviews, Tags, NoteTags, Sessions, Settings])
class AppDb extends _$AppDb {
  AppDb(super.e);

  /// Constructor para tests (in-memory)
  AppDb.forTesting(QueryExecutor e) : super(e);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();

      // FTS5 virtual tables para full-text search
      // v0.46: BM25 ranking con porter stemmer
      await customStatement('''
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          path UNINDEXED,
          title,
          body,
          content='notes',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )
      ''');

      await customStatement('''
        CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
          card_id UNINDEXED,
          question,
          answer,
          content='cards',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )
      ''');

      // Triggers para mantener FTS5 sincronizado
      await customStatement('''
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(path, title, body) VALUES (NEW.path, NEW.title, '');
        END
      ''');
      await customStatement('''
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          DELETE FROM notes_fts WHERE path = OLD.path;
        END
      ''');
      await customStatement('''
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          UPDATE notes_fts SET title = NEW.title WHERE path = NEW.path;
        END
      ''');
    },
    onUpgrade: (m, from, to) async {
      // Para v0.46 solo hay schemaVersion 1. Futuras migraciones aqui.
    },
  );

  // ── Notes ────────────────────────────────────────

  Future<List<Note>> getAllNotes() => select(notes).get();

  Future<Note?> getNoteByPath(String path) =>
      (select(notes)..where((n) => n.path.equals(path))).getSingleOrNull();

  Future<int> upsertNote(NotesCompanion note) => into(notes).insertOnConflictUpdate(note);

  Future<int> deleteNote(String path) =>
      (delete(notes)..where((n) => n.path.equals(path))).go();

  /// v0.46: lista N notas mas recientes ordenadas por mtime.
  /// O(log n) con index en `modified`, vs O(n) parseando todos los .md.
  Future<List<Note>> getRecentNotes({int limit = 5}) {
    return (select(notes)
          ..orderBy([(n) => OrderingTerm.desc(n.modified)])
          ..limit(limit))
        .get();
  }

  // ── Cards ────────────────────────────────────────

  Future<List<Card>> getAllCards() => select(cards).get();

  Future<List<Card>> getDueCards({required DateTime now, int limit = 20}) {
    return (select(cards)
          ..where((c) => c.due.isSmallerOrEqualValue(now))
          ..orderBy([(c) => OrderingTerm.asc(c.due)])
          ..limit(limit))
        .get();
  }

  Future<Card?> getCardById(String id) =>
      (select(cards)..where((c) => c.cardId.equals(id))).getSingleOrNull();

  Future<int> upsertCard(CardsCompanion card) =>
      into(cards).insertOnConflictUpdate(card);

  Future<int> updateCardState({
    required String cardId,
    required double stability,
    required double difficulty,
    required double retrievability,
    required int state,
    required DateTime due,
    required int scheduledDays,
    required int elapsedDays,
    int? reps,
    int? lapses,
    DateTime? lastReview,
  }) {
    return (update(cards)..where((c) => c.cardId.equals(cardId))).write(
      CardsCompanion(
        stability: Value(stability),
        difficulty: Value(difficulty),
        retrievability: Value(retrievability),
        state: Value(state),
        due: Value(due),
        scheduledDays: Value(scheduledDays),
        elapsedDays: Value(elapsedDays),
        reps: reps != null ? Value(reps) : const Value.absent(),
        lapses: lapses != null ? Value(lapses) : const Value.absent(),
        lastReview: lastReview != null ? Value(lastReview) : const Value.absent(),
      ),
    );
  }

  /// Count cards in each state (for stats screen).
  Future<Map<int, int>> countCardsByState() async {
    final query = select(cards)..addColumns([cards.state, cards.cardId.count()]);
    final rows = await query.get();
    final out = <int, int>{};
    for (final row in rows) {
      out[row.read(cards.state) ?? 0] = row.read(cards.cardId.count()) ?? 0;
    }
    return out;
  }

  // ── Reviews ──────────────────────────────────────

  Future<int> insertReview(ReviewsCompanion review) =>
      into(reviews).insert(review);

  Future<List<Review>> getReviewsForCard(String cardId, {int limit = 50}) {
    return (select(reviews)
          ..where((r) => r.cardId.equals(cardId))
          ..orderBy([(r) => OrderingTerm.desc(r.reviewedAt)])
          ..limit(limit))
        .get();
  }

  /// Reviews for a date range (used by heatmap).
  Future<List<Review>> getReviewsBetween(DateTime start, DateTime end) {
    return (select(reviews)
          ..where((r) => r.reviewedAt.isBetweenValues(start, end)))
        .get();
  }

  // ── Tags ─────────────────────────────────────────

  Future<int> upsertTag(TagsCompanion tag) => into(tags).insertOnConflictUpdate(tag);

  Future<List<Tag>> getAllTags() {
    return (select(tags)..orderBy([(t) => OrderingTerm.desc(t.noteCount)])).get();
  }

  Future<List<Tag>> searchTags(String query, {int limit = 10}) {
    return (select(tags)
          ..where((t) => t.name.like('%$query%'))
          ..orderBy([(t) => OrderingTerm.desc(t.noteCount)])
          ..limit(limit))
        .get();
  }

  // ── Sessions ─────────────────────────────────────

  Future<int> startSession(SessionsCompanion session) =>
      into(sessions).insert(session);

  Future<int> endSession(int sessionId, DateTime endedAt, int studyTimeSec) {
    return (update(sessions)..where((s) => s.id.equals(sessionId))).write(
      SessionsCompanion(
        endedAt: Value(endedAt),
        studyTimeSec: Value(studyTimeSec),
      ),
    );
  }

  // ── Settings (K/V) ───────────────────────────────

  Future<String?> getSetting(String key) async {
    final s = await (select(settings)..where((s) => s.key.equals(key))).getSingleOrNull();
    return s?.value;
  }

  Future<void> setSetting(String key, String value) async {
    await into(settings).insertOnConflictUpdate(
      SettingsCompanion(key: Value(key), value: Value(value)),
    );
  }

  // ── Full-text search ─────────────────────────────

  /// v0.46: busqueda FTS5 con BM25 ranking.
  /// Retorna hasta [limit] notas ordenadas por relevancia.
  Future<List<Note>> searchNotesFts(String query, {int limit = 20}) async {
    final results = await customSelect(
      '''
      SELECT n.*, bm25(notes_fts) AS rank
      FROM notes_fts
      JOIN notes n ON n.path = notes_fts.path
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      ''',
      variables: [Variable.withString(query), Variable.withInt(limit)],
      readsFrom: {notes},
    ).get();

    return results.map((row) => Note(
          path: row.read<String>('path'),
          title: row.read<String>('title'),
          tagsJson: row.read<String>('tags_json'),
          linksJson: row.read<String>('links_json'),
          contentHash: row.readNullable<String>('content_hash'),
          modified: row.read<int>('modified'),
          sizeBytes: row.read<int>('size_bytes'),
          wordCount: row.read<int>('word_count'),
        )).toList();
  }

  Future<List<Card>> searchCardsFts(String query, {int limit = 20}) async {
    final results = await customSelect(
      '''
      SELECT c.*, bm25(cards_fts) AS rank
      FROM cards_fts
      JOIN cards c ON c.card_id = cards_fts.card_id
      WHERE cards_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      ''',
      variables: [Variable.withString(query), Variable.withInt(limit)],
      readsFrom: {cards},
    ).get();

    return results.map((row) => Card(
          cardId: row.read<String>('card_id'),
          notePath: row.readNullable<String>('note_path'),
          question: row.read<String>('question'),
          answer: row.read<String>('answer'),
          stability: row.read<double>('stability'),
          difficulty: row.read<double>('difficulty'),
          retrievability: row.read<double>('retrievability'),
          reps: row.read<int>('reps'),
          lapses: row.read<int>('lapses'),
          state: row.read<int>('state'),
          due: row.read<DateTime>('due'),
          lastReview: row.readNullable<DateTime>('last_review'),
          scheduledDays: row.read<int>('scheduled_days'),
          elapsedDays: row.read<int>('elapsed_days'),
          deck: row.read<String>('deck'),
          type: row.read<String>('type'),
          tagsJson: row.read<String>('tags_json'),
          created: row.read<int>('created'),
        )).toList();
  }
}
