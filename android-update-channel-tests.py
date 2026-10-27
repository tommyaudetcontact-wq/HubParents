from pathlib import Path
import tempfile,subprocess,os
root=Path(__file__).resolve().parent
tools=Path(os.environ.get('BRAWL_ANDROID_TOOLS',str(root.parent.parent/'apk-test-20261025/tools')))
jdk=next((tools/'jdk').iterdir())
code="""package com.brawlville.game;
public class ChannelTests {
 static void check(boolean value){if(!value)throw new AssertionError("Update channels must stay isolated");}
 public static void main(String[] args){String preview="com.brawlacademy.preview",production="com.brawlville.game";
 check(UpdateChannel.acceptsOrigin(preview,"https://tommyaudetcontact-wq.github.io"));
 for(String invalid:new String[]{"http://tommyaudetcontact-wq.github.io","https://tommyaudetcontact-wq.github.io.evil.example","https://user:secret@tommyaudetcontact-wq.github.io","https://test.trycloudflare.com","https://tommyaudetcontact-wq.github.io/HubParents"})check(!UpdateChannel.acceptsOrigin(preview,invalid));
 check(UpdateChannel.acceptsOrigin(production,"https://server-one.trycloudflare.com"));check(!UpdateChannel.acceptsOrigin(production,UpdateChannel.previewOrigin()));check(!UpdateChannel.acceptsOrigin("unknown.package",UpdateChannel.previewOrigin()));
 check(UpdateChannel.apkPath(preview).equals("/HubParents/downloads/Brawl-Academy-3D.apk"));check(UpdateChannel.apkPath(production).equals("/app/apk"));check(!UpdateChannel.apkPath(preview).equals(UpdateChannel.apkPath(production)));
 for(String url:UpdateChannel.previewManifests()){check(url.startsWith("https://"));check(url.contains("/downloads/versions.json"));check(!url.contains("server-location.json"));}
 System.out.println("3D Android updates: own manifest and APK, official HTTPS hosts only, offline-PC discovery and separate production channel passed.");
 }
}
"""
with tempfile.TemporaryDirectory(prefix='brawl-update-policy-') as temp:
 folder=Path(temp);source=folder/'ChannelTests.java';source.write_text(code,encoding='utf-8')
 subprocess.run([str(jdk/'bin/javac.exe'),'--release','8','-d',temp,str(root/'android/src/com/brawlville/game/UpdateChannel.java'),str(source)],check=True)
 subprocess.run([str(jdk/'bin/java.exe'),'-cp',temp,'com.brawlville.game.ChannelTests'],check=True)
