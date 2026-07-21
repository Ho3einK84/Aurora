<?php

/**
 * Shared-hosting reverse proxy for Aurora + Rebecca.
 *
 * IMPORTANT: This is a proxy, not a replacement for Rebecca. The real Rebecca
 * panel must still render dist/index.html server-side at its configured
 * "Custom templates directory" + "Subscription page template" path. This script
 * only forwards traffic so the subscription page and config endpoints can live
 * on a separate cPanel-style PHP host while the panel itself stays untouched.
 */

$config = require __DIR__ . '/config.php';

/** Hop-by-hop headers that must not be forwarded in either direction. */
const HOP_BY_HOP = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
];

function abort($code, $message)
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

/**
 * Build the target URL from the configured panel base + the original request URI.
 */
$base = rtrim($config['panel_url'], '/');
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$targetUrl = $base . $requestUri;

if (!filter_var($targetUrl, FILTER_VALIDATE_URL)) {
    abort(500, 'Invalid target panel URL. Check panel_url in config.php.');
}

$ch = curl_init();
if ($ch === false) {
    abort(500, 'Failed to initialize cURL.');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$verify = !empty($config['verify_ssl']);

curl_setopt_array($ch, [
    CURLOPT_URL => $targetUrl,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => max(1, (int) ($config['timeout'] ?? 30)),
    CURLOPT_FOLLOWLOCATION => false, // we handle redirects ourselves
    CURLOPT_SSL_VERIFYPEER => $verify,
    CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
    CURLOPT_HEADER => false,
]);

/* ---------------------------------------------------------- forward body */

if ($method !== 'GET' && $method !== 'HEAD') {
    $body = file_get_contents('php://input');
    if ($body !== false && $body !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
}

/* --------------------------------------------------------- headers out */

$forwardHeaders = [];

if (function_exists('getallheaders')) {
    $clientHeaders = getallheaders();
} else {
    // Fallback for PHP-FPM / CGI setups where getallheaders() is unavailable.
    $clientHeaders = [];
    foreach ($_SERVER as $key => $value) {
        if (strpos($key, 'HTTP_') === 0) {
            $name = str_replace('_', '-', substr($key, 5));
            $clientHeaders[$name] = $value;
        } elseif (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
            $name = str_replace('_', '-', $key);
            $clientHeaders[$name] = $value;
        }
    }
}

foreach ($clientHeaders as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, HOP_BY_HOP, true)) {
        continue;
    }
    if (in_array($lower, ['host', 'content-length', 'expect'], true)) {
        continue;
    }
    $forwardHeaders[] = "$name: $value";
}

$forwardedFor = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
if ($forwardedFor !== '') {
    $forwardHeaders[] = 'X-Forwarded-For: ' . $forwardedFor . ', ' . ($_SERVER['REMOTE_ADDR'] ?? '');
} elseif (isset($_SERVER['REMOTE_ADDR'])) {
    $forwardHeaders[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
}

if (isset($_SERVER['HTTP_X_REAL_IP'])) {
    $forwardHeaders[] = 'X-Real-IP: ' . $_SERVER['HTTP_X_REAL_IP'];
}

$proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$forwardHeaders[] = 'X-Forwarded-Proto: ' . $proto;
$forwardHeaders[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? '');

curl_setopt($ch, CURLOPT_HTTPHEADER, $forwardHeaders);

/* --------------------------------------------------------- headers back */

$responseHeaders = [];
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($curl, $headerLine) use (&$responseHeaders) {
    $responseHeaders[] = $headerLine;
    return strlen($headerLine);
});

/* ----------------------------------------------------------- execute */

$responseBody = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
$errno = curl_errno($ch);
curl_close($ch);

if ($errno) {
    abort(500, "Proxy error ($errno): $error");
}

http_response_code($statusCode);

/* ---------------------------------------------------------- emit headers */

$incomingHost = $_SERVER['HTTP_HOST'] ?? '';

foreach ($responseHeaders as $headerLine) {
    $headerLine = rtrim($headerLine, "\r\n");

    // cURL includes the status line in headers; skip it because we already set one.
    if ($headerLine === '' || preg_match('/^HTTP\/\d(?:\.\d)?\s+\d/', $headerLine)) {
        continue;
    }

    $colon = strpos($headerLine, ':');
    if ($colon === false) {
        continue;
    }

    $name = substr($headerLine, 0, $colon);
    $value = ltrim(substr($headerLine, $colon + 1));
    $lower = strtolower($name);

    if (in_array($lower, HOP_BY_HOP, true)) {
        continue;
    }

    // Rewrite backend Location headers so the client stays on the shared-hosting
    // domain instead of being redirected to the real panel URL.
    if ($lower === 'location') {
        $value = rewriteLocation($value, $base, $proto, $incomingHost, $requestUri);
    }

    header("$name: $value", false);
}

echo $responseBody;

/**
 * Rewrite a backend Location so its scheme/host match the proxy's public URL,
 * keeping only path + query. This prevents leaking the panel URL or sending the
 * client to an address it may not be able to reach.
 */
function rewriteLocation($location, $panelBase, $incomingProto, $incomingHost, $requestUri)
{
    if ($location === '' || $incomingHost === '') {
        return $location;
    }

    // Already relative — keep as-is.
    if (!preg_match('/^https?:\/\//i', $location)) {
        return $location;
    }

    $parsed = parse_url($location);
    if ($parsed === false) {
        return $location;
    }

    $panelParsed = parse_url($panelBase);
    if ($panelParsed === false) {
        return $location;
    }

    $backendHost = ($panelParsed['host'] ?? '') . (isset($panelParsed['port']) ? ':' . $panelParsed['port'] : '');
    $locationHost = ($parsed['host'] ?? '') . (isset($parsed['port']) ? ':' . $parsed['port'] : '');

    // Only rewrite when the redirect points at the configured panel host.
    if (strcasecmp($locationHost, $backendHost) !== 0) {
        return $location;
    }

    $path = $parsed['path'] ?? '/';
    $query = isset($parsed['query']) ? '?' . $parsed['query'] : '';
    $fragment = isset($parsed['fragment']) ? '#' . $parsed['fragment'] : '';

    return $incomingProto . '://' . $incomingHost . $path . $query . $fragment;
}
