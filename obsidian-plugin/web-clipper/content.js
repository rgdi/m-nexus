// content.js: extrae metadata de la página cuando se carga.
// v0.33: detecta si es un artículo médico (OpenAlex, PubMed, etc.) y lo marca.
(function () {
  const isMedical = /pubmed|openalex|nih|nejm|thelancet|bmj|jamanetwork|cochrane/i.test(
    location.hostname
  );
  if (isMedical) {
    document.documentElement.setAttribute("data-mnexus-medical", "true");
  }
})();
