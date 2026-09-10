// embed_service.dart: detecta y formatea embeds de URLs comunes.
//
// v0.51: soporta YouTube, Twitter/X, GitHub Gist, CodePen, Spotify,
// Vimeo, Loom, generic iframe.
// v0.51: cada URL se convierte a un "embed URL" que se puede cargar
// via webview o iframe (cuando haya WebView plugin en v0.51.1).

class EmbedInfo {
  final String type; // 'youtube' | 'twitter' | 'gist' | 'codepen' | 'spotify' | 'vimeo' | 'loom' | 'iframe' | 'image'
  final String embedUrl; // URL lista para iframe
  final String originalUrl;
  final String? title; // opcional, despues de fetch
  final int width;
  final int height;
  final bool isIframeable; // true si se puede poner en <iframe>
  const EmbedInfo({
    required this.type,
    required this.embedUrl,
    required this.originalUrl,
    this.title,
    this.width = 0,
    this.height = 0,
    this.isIframeable = true,
  });
}

class EmbedService {
  /// v0.51: detecta el tipo de embed y devuelve info estructurada.
  /// Retorna null si la URL no es un embed conocido (se trata como link).
  static EmbedInfo? detect(String url) {
    if (url.isEmpty) return null;
    final u = url.trim();

    // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
    final ytId = _extractYouTubeId(u);
    if (ytId != null) {
      return EmbedInfo(
        type: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/$ytId',
        originalUrl: u,
        width: 560,
        height: 315,
      );
    }

    // Twitter/X: twitter.com/USER/status/ID o x.com/USER/status/ID
    if (RegExp(r'^(https?://)?(www\.)?(twitter|x)\.com/[^/]+/status/\d+').hasMatch(u)) {
      return EmbedInfo(
        type: 'twitter',
        embedUrl: 'https://platform.twitter.com/embed/Tweet.html?url=${Uri.encodeComponent(u)}',
        originalUrl: u,
        width: 550,
        height: 250,
      );
    }

    // GitHub Gist: gist.github.com/USER/ID
    final gistMatch = RegExp(r'^(https?://)?gist\.github\.com/([^/]+/)?([a-f0-9]+)').firstMatch(u);
    if (gistMatch != null) {
      return EmbedInfo(
        type: 'gist',
        embedUrl: '${gistMatch.group(0)}.js',
        originalUrl: u,
        width: 0,
        height: 0,
        // Gist requiere <script>, no iframe directo
        isIframeable: false,
      );
    }

    // CodePen: codepen.io/USER/pen/ID
    if (RegExp(r'^(https?://)?codepen\.io/[^/]+/pen/[^/]+').hasMatch(u)) {
      return EmbedInfo(
        type: 'codepen',
        embedUrl: '${u.replaceFirst('/pen/', '/embed/')}?default-tab=js%2Cresult',
        originalUrl: u,
        width: 800,
        height: 460,
      );
    }

    // Spotify: open.spotify.com/track/ID, /album/ID, /playlist/ID
    if (RegExp(r'^(https?://)?open\.spotify\.com/(track|album|playlist|episode)/[a-zA-Z0-9]+').hasMatch(u)) {
      final embed = u.replaceFirst('open.spotify.com/', 'open.spotify.com/embed/');
      return EmbedInfo(
        type: 'spotify',
        embedUrl: embed,
        originalUrl: u,
        width: 300,
        height: 380,
      );
    }

    // Vimeo: vimeo.com/ID
    final vimeoMatch = RegExp(r'^(https?://)?(www\.)?vimeo\.com/(\d+)').firstMatch(u);
    if (vimeoMatch != null) {
      return EmbedInfo(
        type: 'vimeo',
        embedUrl: 'https://player.vimeo.com/video/${vimeoMatch.group(3)}',
        originalUrl: u,
        width: 640,
        height: 360,
      );
    }

    // Loom: loom.com/share/ID o loom.com/embed/ID
    final loomMatch = RegExp(r'loom\.com/(share|embed)/([a-f0-9]+)').firstMatch(u);
    if (loomMatch != null) {
      return EmbedInfo(
        type: 'loom',
        embedUrl: 'https://www.loom.com/embed/${loomMatch.group(2)}',
        originalUrl: u,
        width: 640,
        height: 360,
      );
    }

    // Imgur: i.imgur.com/ID.jpg (detectamos como image embed)
    if (RegExp(r'^https?://i\.imgur\.com/[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)$').hasMatch(u)) {
      return EmbedInfo(
        type: 'image',
        embedUrl: u,
        originalUrl: u,
        width: 0,
        height: 0,
        isIframeable: false,
      );
    }

    // Generic URL - link normal, no embed
    return null;
  }

  /// v0.51: extrae el ID de YouTube de varias formas
  static String? _extractYouTubeId(String url) {
    // youtu.be/ID
    final m1 = RegExp(r'youtu\.be/([a-zA-Z0-9_-]{11})').firstMatch(url);
    if (m1 != null) return m1.group(1);
    // youtube.com/watch?v=ID
    final m2 = RegExp(r'youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})').firstMatch(url);
    if (m2 != null) return m2.group(1);
    // youtube.com/embed/ID
    final m3 = RegExp(r'youtube\.com/embed/([a-zA-Z0-9_-]{11})').firstMatch(url);
    if (m3 != null) return m3.group(1);
    // youtube.com/shorts/ID
    final m4 = RegExp(r'youtube\.com/shorts/([a-zA-Z0-9_-]{11})').firstMatch(url);
    if (m4 != null) return m4.group(1);
    return null;
  }

  /// v0.51: para markdown, genera la sintaxis :::embed URL:::
  static String serialize(EmbedInfo info) {
    return ':::embed ${info.originalUrl}';
  }

  /// v0.51: parsea markdown con :::embed URL:::
  static String? parseFromMarkdown(String text) {
    final m = RegExp(r'^:::embed\s+(.+)$', multiLine: true).firstMatch(text);
    return m?.group(1)?.trim();
  }
}
