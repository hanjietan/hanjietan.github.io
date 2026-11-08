/* ES5, launch-only public update loader for the Meteoblue cache client. */
(function (root) {
  "use strict";
  var MARKER = "<!-- kindle-weather-package:v1 -->";
  var SOURCE = "<!-- kindle-weather-source:meteoblue-cache:v1 -->";
  function validEndpoint(url) {
    return /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/contents\/[^?#\s]+(?:\?ref=[^&#\s]+)?$/.test(url);
  }
  function validHTML(html) {
    return typeof html === "string" && html.length <= 900000 &&
      html.indexOf(MARKER) >= 0 && html.indexOf(SOURCE) >= 0 &&
      /<html(?:\s|>)/i.test(html) && /<\/html\s*>/i.test(html) &&
      /<canvas\b[^>]*\bid\s*=\s*["']screen["']/i.test(html) &&
      !/open[-_]?meteo|rainviewer|my\.meteoblue\.com|[?&]apikey\s*=|github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i.test(html);
  }
  function create(options) {
    options = options || {};
    var endpoint = options.endpoint || "", loading = false, fallback = "";
    try { fallback = decodeURIComponent(escape(root.atob(options.fallbackBase64 || ""))); } catch (ignore) {}
    function install(html, mode, reason) {
      loading = false;
      root.KindleRemoteUpdateState = {mode:mode,reason:reason || null,endpoint:endpoint,checkedAt:new Date().getTime(),source:"meteoblue-cache"};
      try { var leave = root.document.createEvent("Event"); leave.initEvent("pagehide", false, false); root.dispatchEvent(leave); } catch (ignore) {}
      root.document.open(); root.document.write(html); root.document.close();
    }
    function useFallback(reason) {
      if (validHTML(fallback)) install(fallback, "embedded", reason);
      else {
        loading = false;
        root.KindleRemoteUpdateState = {mode:"error",reason:"invalid-embedded-page",source:"meteoblue-cache"};
        root.document.body.textContent = "天气页面不可用，请重新打开入口。没有加载其他天气数据源。";
      }
    }
    function check() {
      if (loading) return false;
      loading = true;
      if (!endpoint) { useFallback("disabled"); return true; }
      if (!validEndpoint(endpoint)) { useFallback("invalid-endpoint"); return true; }
      var xhr = new root.XMLHttpRequest(), finished = false;
      function complete(reason) {
        if (finished) return;
        finished = true;
        if (reason) { useFallback(reason); return; }
        if (xhr.responseURL && !validEndpoint(xhr.responseURL)) { useFallback("unexpected-response-url"); return; }
        if (!validHTML(xhr.responseText)) { useFallback("invalid-remote-page"); return; }
        install(xhr.responseText, "remote", null);
      }
      xhr.onload = function () { complete(xhr.status === 200 ? null : "http-" + xhr.status); };
      xhr.onerror = function () { complete("network-error"); };
      xhr.ontimeout = function () { complete("timeout"); };
      try {
        xhr.open("GET", endpoint, true);
        xhr.timeout = 15000;
        xhr.setRequestHeader("Accept", "application/vnd.github.raw+json");
        xhr.send(null);
      } catch (error) { complete("request-error"); }
      return true;
    }
    return {start:check,check:check};
  }
  root.KindleRemoteLoader = {create:create,validHTML:validHTML,validEndpoint:validEndpoint,marker:MARKER,sourceMarker:SOURCE};
}(this));
