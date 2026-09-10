// youtube_embed.dart: embed especifico para YouTube (v0.61.2).
//
// Detecta URLs YouTube y las abre in-app con WebView optimizado.

import 'package:flutter/material.dart';
import 'webview_embed.dart';

class YouTubeEmbed extends StatelessWidget {
  final String videoId;
  final double? height;
  const YouTubeEmbed({super.key, required this.videoId, this.height});

  static String? extractId(String url) {
    // Match: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
    final patterns = [
      RegExp(r'youtube\.com/watch\?v=([\w-]{11})'),
      RegExp(r'youtu\.be/([\w-]{11})'),
      RegExp(r'youtube\.com/embed/([\w-]{11})'),
    ];
    for (final p in patterns) {
      final m = p.firstMatch(url);
      if (m != null) return m.group(1);
    }
    // Si es solo el ID
    if (RegExp(r'^[\w-]{11}$').hasMatch(url)) return url;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final url = 'https://www.youtube.com/embed/$videoId';
    return WebViewEmbed(
      url: url,
      title: 'YouTube: $videoId',
      allowJavaScript: true,
      height: height,
    );
  }
}

class TwitterEmbed extends StatelessWidget {
  final String tweetUrl;
  final double? height;
  const TwitterEmbed({super.key, required this.tweetUrl, this.height});

  @override
  Widget build(BuildContext context) {
    // Twitter/X oEmbed via platform.twitter.com
    return WebViewEmbed(
      url: 'https://platform.twitter.com/embed/Tweet.html?url=${Uri.encodeComponent(tweetUrl)}',
      title: 'X (Twitter)',
      height: height ?? 500,
    );
  }
}
