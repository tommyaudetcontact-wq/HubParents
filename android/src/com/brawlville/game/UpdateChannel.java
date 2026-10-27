package com.brawlville.game;
/** Keeps the experimental APK and production APK on their own signed update channel. */
public final class UpdateChannel {
 private UpdateChannel(){}
 public static boolean is3D(String applicationId){return "com.brawlacademy.preview".equals(applicationId);}
 public static String[] previewManifests(){return new String[]{"https://tommyaudetcontact-wq.github.io/HubParents/downloads/versions.json?t=","https://raw.githubusercontent.com/tommyaudetcontact-wq/HubParents/main/downloads/versions.json?t="};}
 public static String previewOrigin(){return "https://tommyaudetcontact-wq.github.io";}
 public static String apkPath(String applicationId){return is3D(applicationId)?"/HubParents/downloads/Brawl-Academy-3D.apk":"/app/apk";}
 public static boolean acceptsOrigin(String applicationId,String origin){if(is3D(applicationId))return previewOrigin().equals(origin);return "com.brawlville.game".equals(applicationId)&&origin!=null&&origin.matches("https://[a-z0-9-]+\\.trycloudflare\\.com");}
}
