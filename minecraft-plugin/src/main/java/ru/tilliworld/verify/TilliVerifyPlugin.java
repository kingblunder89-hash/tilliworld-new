package ru.tilliworld.verify;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * /tilliverify КОД — отправляет на сайт код, ник и UUID игрока, который реально вошёл на сервер.
 * Сайт сверяет код (выдан вошедшему пользователю сайта) и секрет плагина, затем привязывает UUID к аккаунту.
 * Ник и UUID берутся из объекта Player, а не из текста команды, поэтому подделать их нельзя.
 */
public final class TilliVerifyPlugin extends JavaPlugin {
    private static final Pattern CODE = Pattern.compile("^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$");
    private final Map<UUID, Long> lastAttempt = new HashMap<>();
    private String baseUrl;
    private String anonKey;
    private String secret;
    private boolean requireOnlineMode;
    private long cooldownMs;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        baseUrl = getConfig().getString("supabase-url", "").trim().replaceAll("/+$", "");
        anonKey = getConfig().getString("supabase-anon-key", "").trim();
        secret = getConfig().getString("plugin-secret", "").trim();
        requireOnlineMode = getConfig().getBoolean("require-online-mode", true);
        cooldownMs = Math.max(1, getConfig().getLong("cooldown-seconds", 5)) * 1000L;
        if (baseUrl.isEmpty() || anonKey.isEmpty() || secret.length() < 32) {
            getLogger().warning("Заполните supabase-url, supabase-anon-key и plugin-secret (минимум 32 символа) в config.yml.");
        }
        if (requireOnlineMode && !Bukkit.getOnlineMode()) {
            getLogger().warning("Сервер в режиме online-mode=false: подтверждение аккаунтов отключено, иначе оно ничего не доказывало бы.");
        }
    }

    private boolean ready() {
        return !baseUrl.isEmpty() && !anonKey.isEmpty() && secret.length() >= 32 && !(requireOnlineMode && !Bukkit.getOnlineMode());
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("Команду можно выполнить только в игре.");
            return true;
        }
        final Player player = (Player) sender;
        if (!ready()) {
            player.sendMessage("§cПодтверждение аккаунта сейчас недоступно. Сообщите администратору.");
            return true;
        }
        if (args.length != 1 || !CODE.matcher(args[0]).matches()) {
            player.sendMessage("§eИспользуйте: /tilliverify КОД (код берётся на сайте в разделе «Аккаунт»).");
            return true;
        }
        long now = System.currentTimeMillis();
        Long prev = lastAttempt.get(player.getUniqueId());
        if (prev != null && now - prev < cooldownMs) {
            player.sendMessage("§eПодождите несколько секунд перед следующей попыткой.");
            return true;
        }
        lastAttempt.put(player.getUniqueId(), now);

        final String code = args[0];
        final UUID uuid = player.getUniqueId();
        final String name = player.getName();
        player.sendMessage("§7Проверяем код…");
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            final String result = confirm(code, uuid, name);
            Bukkit.getScheduler().runTask(this, () -> player.sendMessage(describe(result)));
        });
        return true;
    }

    @Override
    public void onDisable() {
        lastAttempt.clear();
    }

    private static String describe(String status) {
        switch (status) {
            case "ok": return "§aГотово! Аккаунт подтверждён, на сайте появится значок.";
            case "invalid_code": return "§cКод неверный или уже использован. Получите новый на сайте.";
            case "expired_code": return "§cСрок действия кода истёк. Получите новый на сайте.";
            case "uuid_taken": return "§cЭтот Minecraft-аккаунт уже привязан к другому аккаунту сайта.";
            case "network_error": return "§cНе удалось связаться с сайтом. Попробуйте позже.";
            default: return "§cПодтверждение не удалось. Сообщите администратору.";
        }
    }

    /** Вызывает SQL-функцию confirm_minecraft_link. Выполняется вне основного потока сервера. */
    private String confirm(String code, UUID uuid, String name) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(baseUrl + "/rest/v1/rpc/confirm_minecraft_link").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", anonKey);
            conn.setRequestProperty("Authorization", "Bearer " + anonKey);
            String body = "{\"p_secret\":" + json(secret) + ",\"p_code\":" + json(code)
                    + ",\"p_mc_uuid\":" + json(uuid.toString()) + ",\"p_mc_name\":" + json(name) + "}";
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8).trim();
            if (status != 200) {
                getLogger().warning("Сайт ответил HTTP " + status);
                return "error";
            }
            String result = text.replace("\"", "");
            if ("invalid_secret".equals(result)) {
                getLogger().warning("Сайт отклонил секрет плагина: проверьте plugin-secret и запись в minecraft_plugin_keys.");
                return "error";
            }
            if ("invalid_player".equals(result)) {
                getLogger().warning("Сайт отклонил ник или UUID игрока: " + name);
                return "error";
            }
            return result;
        } catch (IOException e) {
            getLogger().warning("Ошибка сети: " + e.getMessage());
            return "network_error";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[1024];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    private static String json(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        return sb.append('"').toString();
    }
}
