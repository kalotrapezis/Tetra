// The phone's encrypted passwords and 2FA files, made as Tetra-mobile's BrowserPasswords.kt makes them (BouncyCastle's
// Argon2id, the JDK's AES-GCM, Android org.json's escaping), with invented data only, for desktop/test/passwords.test.js.
// BouncyCastle is first checked against RFC 9106's Argon2id vector, so the desktop's libsodium is checked through it.
//   java -cp ~/.gradle/caches/…/bcprov-jdk18on-1.80.2.jar Make.java <out dir>
import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;

public class Make {
    static final Base64.Encoder B64 = Base64.getEncoder();
    static final SecureRandom RND = new SecureRandom();

    // libcore's JSONStringer.string(): '/' escaped too, control characters as \\u%04x
    static String q(String s) {
        StringBuilder o = new StringBuilder("\"");
        for (char c : s.toCharArray()) switch (c) {
            case '"': case '\\': case '/': o.append('\\').append(c); break;
            case '\t': o.append("\\t"); break; case '\b': o.append("\\b"); break; case '\n': o.append("\\n"); break;
            case '\r': o.append("\\r"); break; case '\f': o.append("\\f"); break;
            default: if (c <= 0x1F) o.append(String.format("\\u%04x", (int) c)); else o.append(c);
        }
        return o.append('"').toString();
    }
    static String arr(String... a) { StringJoiner j = new StringJoiner(",", "[", "]"); for (String s : a) j.add(q(s)); return j.toString(); }

    static byte[] argon(byte[] pass, byte[] salt, byte[] secret, byte[] ad, int m, int t, int p) {
        Argon2Parameters.Builder b = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id).withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withSalt(salt).withMemoryAsKB(m).withIterations(t).withParallelism(p);
        if (secret != null) b.withSecret(secret);
        if (ad != null) b.withAdditional(ad);
        Argon2BytesGenerator g = new Argon2BytesGenerator(); g.init(b.build());
        byte[] out = new byte[32]; g.generateBytes(pass, out); return out;
    }
    // as BrowserPasswords.derive: the passphrase's chars, which BouncyCastle turns into UTF-8
    static byte[] argonChars(char[] pass, byte[] salt, int m) {
        Argon2BytesGenerator g = new Argon2BytesGenerator();
        g.init(new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id).withVersion(Argon2Parameters.ARGON2_VERSION_13).withSalt(salt).withMemoryAsKB(m).withIterations(1).withParallelism(1).build());
        byte[] out = new byte[32]; g.generateBytes(pass, out); return out;
    }
    static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }

    static String[] seal(byte[] key, byte[] plain, String aad) throws Exception {
        byte[] nonce = new byte[12]; RND.nextBytes(nonce);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return new String[] { B64.encodeToString(nonce), B64.encodeToString(c.doFinal(plain)) };
    }

    // a record: {"v":…,"at":…} (+ "gone":true), as SecretSet.json() writes it
    static String rec(String v, long at, boolean gone) { return "{\"v\":" + q(v) + ",\"at\":" + at + (gone ? ",\"gone\":true" : "") + "}"; }
    static String set(String... kv) { StringJoiner j = new StringJoiner(",", "{", "}"); for (int i = 0; i < kv.length; i += 2) j.add(q(kv[i]) + ":" + kv[i + 1]); return j.toString(); }

    public static void main(String[] a) throws Exception {
        // RFC 9106 §5.3
        byte[] pass = new byte[32]; Arrays.fill(pass, (byte) 1); byte[] salt0 = new byte[16]; Arrays.fill(salt0, (byte) 2);
        byte[] sec = new byte[8]; Arrays.fill(sec, (byte) 3); byte[] ad = new byte[12]; Arrays.fill(ad, (byte) 4);
        String tag = hex(argon(pass, salt0, sec, ad, 32, 3, 4));
        if (!tag.equals("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659")) throw new AssertionError("RFC 9106: " + tag);

        Path out = Paths.get(a[0]);
        Files.createDirectories(out.resolve("Passwords")); Files.createDirectories(out.resolve("TwoFactor"));
        byte[] salt = new byte[16]; RND.nextBytes(salt);
        String phrase = "correct horse battery staple ✓";
        byte[] key = argonChars(phrase.toCharArray(), salt, 1024);
        String[] check = seal(key, "tetra-browser-passwords".getBytes(StandardCharsets.UTF_8), "check");
        String s = B64.encodeToString(salt);
        Files.writeString(out.resolve("Passwords/key.json"), "{\n \"v\": 1,\n \"kdf\": \"argon2id\",\n \"m\": 1024,\n \"t\": 1,\n \"p\": 1,\n \"salt\": \"" + s + "\",\n \"made\": 1000,\n \"check\": \"" + check[0] + "." + check[1] + "\"\n}\n");
        // a Argon2id p=1 vector for the desktop's own library, at Tetra's settings
        Files.writeString(out.resolve("vector.json"), "{\"passphrase\":" + q(phrase) + ",\"salt\":\"" + s + "\",\"m\":1024,\"t\":1,\"key\":\"" + hex(key) + "\"}\n");

        String l1 = arr("example.org", "maria", "Pa/ss\"w0rd\\x"), l2 = arr("https://shop.example.com/login", "ana@example.org", "second-pw", "for the shop", "1");
        String l2b = arr("https://shop.example.com/login", "ana@example.org", "changed-on-tablet");
        String card = arr("ANA EXAMPLE", "4111111111111111", "01", "30");
        String addr = arr("email", "ana@example.org", "name", "Ana Example", "street-address", "12/3 Example Street\nFlat 4");
        String phone = set(
            "l|example.org|maria", rec(l1, 1000, false),
            "l|https://shop.example.com/login|ana@example.org", rec(l2, 3000, false),
            "c|4111111111111111", rec(card, 1000, false),
            "a|" + addr, rec(addr, 1000, false),
            "l|old.example.net|x", rec(arr("old.example.net", "x", "y"), 2000, true));
        String tablet = set(
            "l|https://shop.example.com/login|ana@example.org", rec(l2b, 2000, false), // older: the phone's wins
            "l|old.example.net|x", rec(arr("old.example.net", "x", "y"), 2000, false), // a tie with the phone's deletion: the living one wins
            "c|4111111111111111", rec(card, 4000, true)); // deleted later on the tablet
        for (String[] f : new String[][] { { "Pixel 9-abc123", phone }, { "Tab S9-def456", tablet } }) {
            String[] nd = seal(key, f[1].getBytes(StandardCharsets.UTF_8), "passwords|" + f[0]);
            Files.writeString(out.resolve("Passwords/" + f[0] + ".enc"), "{\n \"v\": 1,\n \"kdf\": \"argon2id\",\n \"m\": 1024,\n \"t\": 1,\n \"p\": 1,\n \"salt\": \"" + s + "\",\n \"nonce\": \"" + nd[0] + "\",\n \"data\": \"" + nd[1] + "\"\n}\n");
        }
        // 2FA: RFC 6238's SHA1 seed; JSONObject keeps its keys' order
        String code = "{\"issuer\":\"Example\",\"account\":\"ana@example.org\",\"secret\":\"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ\",\"algorithm\":\"SHA1\",\"digits\":6,\"period\":30,\"pinned\":true}";
        String two = set("example|ana@example.org|GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", rec(code, 1000, false));
        String[] nd = seal(key, two.getBytes(StandardCharsets.UTF_8), "2fa|Pixel 9-abc123");
        Files.writeString(out.resolve("TwoFactor/Pixel 9-abc123.enc"), "{\n \"v\": 1,\n \"kdf\": \"argon2id\",\n \"m\": 1024,\n \"t\": 1,\n \"p\": 1,\n \"salt\": \"" + s + "\",\n \"nonce\": \"" + nd[0] + "\",\n \"data\": \"" + nd[1] + "\"\n}\n");
        // the values exactly as the phone's keyed() makes them, for the desktop to make the same
        Files.writeString(out.resolve("expected.json"), "{\"login1\":" + q(l1) + ",\"login2\":" + q(l2) + ",\"card\":" + q(card) + ",\"address\":" + q(addr) + ",\"code\":" + q(code) + "}\n");
        System.out.println("ok, RFC 9106 " + tag.substring(0, 8) + "…");
    }
}
