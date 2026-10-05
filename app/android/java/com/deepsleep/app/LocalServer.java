package com.deepsleep.app;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 内置本地 HTTP 服务，绑定 127.0.0.1。
 *
 * 作用有两个：
 *  1. 把 assets 里的前端页面以 http:// 方式提供出来，使其成为「真实源」，
 *     从而可以同源 fetch，且 127.0.0.1 属于可信来源（剪贴板等 API 可用）。
 *  2. 作为 API 反向代理：把前端的请求连同 Authorization 头转发给用户自填的接口地址，
 *     并把 SSE 响应以 chunked 方式原样流回页面。这样既不受 WebView 的 CORS 限制，
 *     也能保证流式输出不被缓冲。
 */
public class LocalServer {

    private static final String TAG = "LocalServer";
    private static final String CRLF = "\r\n";

    public interface Logger {
        void log(String message);
    }

    private final AssetManager assets;
    private final String appToken;
    private final String appVersion;
    private final Logger logger;

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running = false;

    public LocalServer(AssetManager assets, String appToken, String appVersion, Logger logger) {
        this.assets = assets;
        this.appToken = appToken;
        this.appVersion = appVersion;
        this.logger = logger;
    }

    /**
     * 启动服务并返回实际监听的端口。
     *
     * 会优先使用传入的端口：页面是从 http://127.0.0.1:<port> 提供的，
     * 而 localStorage 按「源」隔离 —— 端口一变，之前存的配置和对话记录
     * 就全读不到了。固定端口能让 origin 保持稳定。
     * 全部被占用时才退回随机端口。
     */
    public int start(int... preferredPorts) throws IOException {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        if (preferredPorts != null) {
            for (int candidate : preferredPorts) {
                if (candidate <= 0) continue;
                try {
                    serverSocket = new ServerSocket(candidate, 64, loopback);
                    break;
                } catch (IOException e) {
                    log("port " + candidate + " unavailable: " + e.getMessage());
                }
            }
        }
        if (serverSocket == null) {
            serverSocket = new ServerSocket(0, 64, loopback);
        }

        running = true;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "local-server-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return serverSocket.getLocalPort();
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket socket = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(socket);
                    }
                });
            } catch (IOException e) {
                if (running) log("accept error: " + e);
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(30000);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream(), 8192);

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                socket.close();
                return;
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }
            String method = parts[0];
            String target = parts[1];

            Map<String, String> headers = new HashMap<String, String>();
            String line;
            int guard = 0;
            while ((line = readLine(in)) != null && line.length() > 0) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US),
                            line.substring(colon + 1).trim());
                }
                if (++guard > 120) break;
            }

            String path = target;
            String query = "";
            int q = path.indexOf('?');
            if (q >= 0) {
                query = path.substring(q + 1);
                path = path.substring(0, q);
            }

            if ("/api/proxy".equals(path)) {
                socket.setSoTimeout(0); // 流式响应期间不设读超时
                handleProxy(out, in, headers);
            } else if ("/__ping".equals(path)) {
                writeResponse(out, 200, "text/plain; charset=utf-8", "ok".getBytes(StandardCharsets.UTF_8), true);
            } else {
                serveStatic(out, path, query);
            }

            out.flush();
            socket.close();
        } catch (Exception e) {
            log("handle error: " + e);
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    /* ------------------------------------------------------------------
       静态资源
       ------------------------------------------------------------------ */

    private void serveStatic(OutputStream out, String path, String query) throws IOException {
        String rel = "/".equals(path) || path.isEmpty() ? "index.html" : path.substring(1);
        if (rel.contains("..")) {
            writeResponse(out, 400, "text/plain", "bad path".getBytes(StandardCharsets.UTF_8), true);
            return;
        }

        byte[] body;
        try {
            InputStream is = assets.open(rel);
            try {
                body = readAll(is);
            } finally {
                is.close();
            }
        } catch (IOException e) {
            writeResponse(out, 404, "text/plain; charset=utf-8",
                    ("not found: " + rel).getBytes(StandardCharsets.UTF_8), true);
            return;
        }

        boolean isHtml = rel.endsWith("index.html");
        if (isHtml) {
            String html = new String(body, StandardCharsets.UTF_8);
            String inject = "<script>window.__DS_APP_TOKEN__=" + jsString(appToken)
                    + ";window.__DS_APP_VERSION__=" + jsString(appVersion) + ";</script>";
            int head = html.indexOf("<head>");
            if (head >= 0) {
                html = html.substring(0, head + 6) + inject + html.substring(head + 6);
            } else {
                html = inject + html;
            }
            body = html.getBytes(StandardCharsets.UTF_8);
        }

        writeResponse(out, 200, mimeOf(rel), body, isHtml);
    }

    private static String mimeOf(String rel) {
        String r = rel.toLowerCase(Locale.US);
        if (r.endsWith(".html") || r.endsWith(".htm")) return "text/html; charset=utf-8";
        if (r.endsWith(".js") || r.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (r.endsWith(".css")) return "text/css; charset=utf-8";
        if (r.endsWith(".json")) return "application/json; charset=utf-8";
        if (r.endsWith(".svg")) return "image/svg+xml";
        if (r.endsWith(".png")) return "image/png";
        if (r.endsWith(".jpg") || r.endsWith(".jpeg")) return "image/jpeg";
        if (r.endsWith(".webp")) return "image/webp";
        if (r.endsWith(".gif")) return "image/gif";
        if (r.endsWith(".ico")) return "image/x-icon";
        if (r.endsWith(".woff2")) return "font/woff2";
        if (r.endsWith(".woff")) return "font/woff";
        if (r.endsWith(".ttf")) return "font/ttf";
        if (r.endsWith(".map")) return "application/json";
        if (r.endsWith(".txt") || r.endsWith(".md")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------
       API 代理（支持 SSE 流式）
       ------------------------------------------------------------------ */

    private void handleProxy(OutputStream out, InputStream in, Map<String, String> headers) {
        HttpURLConnection conn = null;
        try {
            String token = headers.get("x-app-token");
            if (token == null || !token.equals(appToken)) {
                jsonError(out, 403, "本地服务令牌校验失败，请重启 App");
                return;
            }

            String base = headers.get("x-api-base");
            String apiPath = headers.get("x-api-path");
            String method = headers.get("x-api-method");
            String apiKey = headers.get("x-api-key");
            boolean skipAuth = headers.containsKey("x-skip-auth");

            if (base == null || apiPath == null) {
                jsonError(out, 400, "缺少接口地址");
                return;
            }

            String full = base + apiPath;
            URL url;
            try {
                url = new URL(full);
            } catch (Exception e) {
                jsonError(out, 400, "接口地址格式不正确：" + full);
                return;
            }
            String protocol = url.getProtocol();
            if (!"http".equals(protocol) && !"https".equals(protocol)) {
                jsonError(out, 400, "只支持 http/https 接口地址");
                return;
            }

            byte[] requestBody = null;
            int contentLength = parseInt(headers.get("content-length"), 0);
            if (contentLength > 0) {
                requestBody = readN(in, contentLength);
            }

            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method == null ? "GET" : method);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(600000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "text/event-stream, application/json, */*;q=0.8");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("User-Agent", "DeepSleep/1.0 (Android)");

            // 鉴权头由前端指定：OpenAI 兼容走 Authorization: Bearer，
            // Anthropic 走 x-api-key（不带方案名）
            String authHeader = headers.get("x-auth-header");
            String authScheme = headers.get("x-auth-scheme");
            String authPrefix = headers.get("x-auth-prefix");
            if (!skipAuth && apiKey != null && apiKey.length() > 0) {
                String headerName = (authHeader == null || authHeader.isEmpty()) ? "Authorization" : authHeader;
                // 关键：HTTP 头值首尾空白会被规范化裁掉，
                // 「Bearer」与 Key 之间的空格必须在这里补，
                // 不能指望前端传一个 "Bearer "（尾空格会消失，
                // 拼出来是 "Bearersk-xxx"，服务端直接 401）。
                String scheme;
                if (authScheme != null) {
                    scheme = authScheme.trim();
                } else {
                    scheme = (authPrefix == null) ? "Bearer" : authPrefix.trim();
                }
                conn.setRequestProperty(headerName, scheme.isEmpty() ? apiKey : scheme + " " + apiKey);
            }

            // 允许前端附带任意上游请求头（anthropic-version、OpenRouter 的 X-Title 等）
            String extraHeaders = headers.get("x-upstream-headers");
            if (extraHeaders != null && extraHeaders.length() > 0) {
                try {
                    JSONObject extraObj = new JSONObject(extraHeaders);
                    java.util.Iterator<String> keys = extraObj.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        if (k == null || k.isEmpty()) continue;
                        String lk = k.toLowerCase(Locale.US);
                        if ("authorization".equals(lk) || "x-api-key".equals(lk)
                                || "host".equals(lk) || "content-length".equals(lk)) {
                            continue; // 这几个不允许前端覆盖
                        }
                        conn.setRequestProperty(k, extraObj.optString(k, ""));
                    }
                } catch (Exception e) {
                    log("bad X-Upstream-Headers: " + e);
                }
            }

            if (requestBody != null) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(requestBody.length);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                OutputStream os = conn.getOutputStream();
                os.write(requestBody);
                os.flush();
                os.close();
            }

            int code = conn.getResponseCode();
            String contentType = conn.getContentType();
            InputStream upstream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (upstream == null) upstream = conn.getErrorStream();

            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(code).append(' ').append(reasonOf(code)).append(CRLF);
            head.append("Content-Type: ").append(contentType == null ? "application/octet-stream" : contentType).append(CRLF);
            head.append("Cache-Control: no-cache, no-store").append(CRLF);
            head.append("X-Upstream-Status: ").append(code).append(CRLF);
            head.append("Transfer-Encoding: chunked").append(CRLF);
            head.append("Connection: close").append(CRLF);
            head.append(CRLF);
            out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
            out.flush();

            if (upstream != null) {
                byte[] buf = new byte[2048];
                int n;
                while ((n = upstream.read(buf)) > 0) {
                    writeChunk(out, buf, n);
                    out.flush();
                }
                upstream.close();
            }
            writeChunkEnd(out);
            out.flush();

        } catch (Exception e) {
            log("proxy error: " + e);
            try {
                jsonError(out, 502, "无法连接到接口地址：" + shortMessage(e));
            } catch (IOException ignored) {
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String shortMessage(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        return m.length() > 200 ? m.substring(0, 200) : m;
    }

    private void jsonError(OutputStream out, int code, String message) throws IOException {
        String safe = message.replace("\\", "\\\\").replace("\"", "\\\"");
        String json = "{\"error\":{\"message\":\"" + safe + "\",\"code\":" + code + "}}";
        writeResponse(out, code, "application/json; charset=utf-8",
                json.getBytes(StandardCharsets.UTF_8), true);
    }

    /* ------------------------------------------------------------------
       HTTP 基础工具
       ------------------------------------------------------------------ */

    /**
     * 本地资源一律 no-store。
     *
     * assets 是随 APK 一起打包、跟着版本走的；一旦允许 WebView 缓存，
     * 升级后就会出现「新页面 + 旧脚本」：index.html 是新的（渲染出新按钮），
     * 而 js/css 还是缓存里的旧版本，点了新按钮旧逻辑不认，表现极其诡异
     * （例如切到新配色却提示切成了官方蓝）。所以这里不再区分类型。
     */
    private void writeResponse(OutputStream out, int code, String contentType, byte[] body, boolean unusedNoCache)
            throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(code).append(' ').append(reasonOf(code)).append(CRLF);
        head.append("Content-Type: ").append(contentType).append(CRLF);
        head.append("Content-Length: ").append(body.length).append(CRLF);
        head.append("X-Content-Type-Options: nosniff").append(CRLF);
        head.append("Cache-Control: no-store, no-cache, must-revalidate").append(CRLF);
        head.append("Pragma: no-cache").append(CRLF);
        head.append("Connection: close").append(CRLF);
        head.append(CRLF);
        out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private void writeChunk(OutputStream out, byte[] data, int length) throws IOException {
        out.write(Integer.toHexString(length).getBytes(StandardCharsets.ISO_8859_1));
        out.write(CRLF.getBytes(StandardCharsets.ISO_8859_1));
        out.write(data, 0, length);
        out.write(CRLF.getBytes(StandardCharsets.ISO_8859_1));
    }

    private void writeChunkEnd(OutputStream out) throws IOException {
        out.write(("0" + CRLF + CRLF).getBytes(StandardCharsets.ISO_8859_1));
    }

    private static String reasonOf(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 402: return "Payment Required";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 408: return "Request Timeout";
            case 413: return "Payload Too Large";
            case 422: return "Unprocessable Entity";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return code >= 500 ? "Server Error" : "OK";
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(128);
        int c;
        boolean any = false;
        while ((c = in.read()) != -1) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
            if (buf.size() > 8192) break;
        }
        if (!any) return null;
        return new String(buf.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] out = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(out, off, n - off);
            if (r < 0) break;
            off += r;
        }
        if (off == n) return out;
        byte[] trimmed = new byte[off];
        System.arraycopy(out, 0, trimmed, 0, off);
        return trimmed;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(16384);
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static int parseInt(String s, int def) {
        if (s == null) return def;
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static String jsString(String s) {
        if (s == null) return "\"\"";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void log(String message) {
        Log.d(TAG, message);
        if (logger != null) logger.log(message);
    }
}
