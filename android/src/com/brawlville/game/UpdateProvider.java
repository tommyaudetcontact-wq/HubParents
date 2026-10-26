package com.brawlville.game;
import android.content.*;import android.database.*;import android.net.Uri;import android.os.*;import android.provider.OpenableColumns;import java.io.*;
public class UpdateProvider extends ContentProvider {
 public boolean onCreate(){return true;}private File file(Uri uri)throws FileNotFoundException{if(!"/update.apk".equals(uri.getPath()))throw new FileNotFoundException();return new File(getContext().getCacheDir(),"update.apk");}
 public String getType(Uri u){return "application/vnd.android.package-archive";}public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(u),ParcelFileDescriptor.MODE_READ_ONLY);}
 public Cursor query(Uri u,String[] projection,String s,String[] args,String order){try{File f=file(u);MatrixCursor c=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});c.addRow(new Object[]{"Brawl-Ville.apk",f.length()});return c;}catch(Exception e){return null;}}
 public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
