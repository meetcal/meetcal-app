(function () {
  var config = window.__MEETCAL_POSTHOG_CONFIG__ || {};
  var apiKey = config.apiKey;
  var apiHost = config.apiHost || "https://us.i.posthog.com";

  if (!apiKey || window.posthog) {
    return;
  }

  (function (t, e) {
    var o;
    var n;
    var p;
    var r;
    e.__SV = 1;
    window.posthog = e;
    e._i = [];
    e.init = function (i, s, a) {
      function g(t, e) {
        var o = e.split(".");
        if (o.length == 2) {
          t = t[o[0]];
          e = o[1];
        }
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }

      p = t.createElement("script");
      p.type = "text/javascript";
      p.crossOrigin = "anonymous";
      p.async = true;
      p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
      r = t.getElementsByTagName("script")[0];
      r.parentNode.insertBefore(p, r);

      var u = e;
      if (a !== undefined) {
        u = e[a] = [];
      } else {
        a = "posthog";
      }
      u.people = u.people || [];
      u.toString = function (t) {
        var e = "posthog";
        if (a !== "posthog") {
          e += "." + a;
        }
        if (!t) {
          e += " (stub)";
        }
        return e;
      };
      u.people.toString = function () {
        return u.toString(1) + ".people (stub)";
      };
      o = "init capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags reloadFeatureFlags getFeatureFlag getFeatureFlagPayload group".split(" ");
      for (n = 0; n < o.length; n++) {
        g(u, o[n]);
      }
      e._i.push([i, s, a]);
    };
  })(document, window.posthog || []);

  window.posthog.init(apiKey, {
    api_host: apiHost,
    autocapture: true,
    capture_pageview: "history_change",
    person_profiles: "identified_only",
  });
})();
