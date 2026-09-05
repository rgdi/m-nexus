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

  /// Carpetas internas del plugin
  static const String internalFolder = '_M-NEXUS';
  static const String flashcardsFolder = '$_internalFolder/Flashcards';
  static const String flashcardsApproved = '$flashcardsFolder/Approved';
  static const String flashcardsDrafts = '$flashcardsFolder/Drafts';
  static const String inboxFolder = '$_internalFolder/Inbox';
  static const String photosFolder = '$_internalFolder/Photos';
  static const String pdfsFolder = '$_internalFolder/PDFs';
  static const String backupsFolder = '$_internalFolder/backups';
}

/// Branding
class Brand {
  static const String logoEmoji = '🧠';
  static const String logoText = 'M';
}
