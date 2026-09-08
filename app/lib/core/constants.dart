// Constantes globales de la app.

class AppConstants {
  static const String name = 'M-NEXUS';
  static const String tagline = 'Tu segundo cerebro digital';

  /// Versión del schema de las notas
  static const int noteSchemaVersion = 2;

  /// Tamaño máximo de nota en KB
  static const int maxNoteSizeKb = 1024;

  /// Extensiones de archivos reconocidas
  static const List<String> mdExtensions = ['.md', '.markdown'];
  static const List<String> imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  static const List<String> audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg'];
  static const List<String> pdfExtensions = ['.pdf'];
  static const List<String> flashcardExtensions = ['.apkg'];

  /// Carpetas internas de la app
  static const String internalFolder = '_M-NEXUS';
  static const String flashcardsFolder = '_M-NEXUS/Flashcards';
  static const String flashcardsApproved = '_M-NEXUS/Flashcards/Approved';
  static const String flashcardsDrafts = '_M-NEXUS/Flashcards/Drafts';
  static const String inboxFolder = '_M-NEXUS/Inbox';
  static const String photosFolder = '_M-NEXUS/Photos';
  static const String pdfsFolder = '_M-NEXUS/PDFs';
  static const String backupsFolder = '_M-NEXUS/backups';

  /// v0.47.36: estructura por asignaturas. El usuario configura
  /// sus asignaturas (e.g., 'Anatomía', 'Fisiología', 'Bioquímica')
  /// y cada asignatura tiene su subcarpeta con notas + flashcards.
  /// NO hay carpetas extra tipo recordings — las grabaciones de
  /// clases son búsquedas en notas (vía transcripción), no archivos.
  /// Default subjects si el usuario no configura nada.
  static const List<String> defaultSubjects = [
    'Anatomía',
    'Fisiología',
    'Bioquímica',
  ];

  /// Subcarpeta donde se guardan los exámenes programados
  /// y la lista oficial de temas por examen.
  static const String examsFolder = '_M-NEXUS/Exams';
  static const String subjectsConfig = '_M-NEXUS/subjects.json';
  static const String examsConfig = '_M-NEXUS/exams.json';

  /// Prioridad FSRS boost (factor multiplicador sobre due-date normal)
  /// para tarjetas cuyos temas están en exámenes próximos.
  /// Cuanto más cerca el examen, más alto el boost (1.0 = normal, 2.0 = doble).
  static double examPriorityBoost(int daysUntilExam) {
    if (daysUntilExam < 0) return 1.0; // ya pasó
    if (daysUntilExam == 0) return 3.0; // hoy
    if (daysUntilExam <= 3) return 2.5; // 1-3 días
    if (daysUntilExam <= 7) return 2.0; // 1 semana
    if (daysUntilExam <= 14) return 1.5; // 2 semanas
    if (daysUntilExam <= 30) return 1.2; // 1 mes
    return 1.0; // más de un mes
  }
}

/// Branding
class Brand {
  static const String logoEmoji = '🧠';
  static const String logoText = 'M';
}
