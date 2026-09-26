// Nomi storefront script. Loaded by the "Nomi Script" app embed.
// Intentionally side-effect free for now: it only marks Nomi as present so
// the storefront pop-up can hook in here later without another theme change.
(function () {
  if (window.Nomi) return;
  var el = document.getElementById("nomi-embed");
  window.Nomi = {
    version: 1,
    shop: el ? el.getAttribute("data-shop") : null,
  };
})();
