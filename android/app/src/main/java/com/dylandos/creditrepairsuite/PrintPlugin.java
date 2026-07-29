package com.dylandos.creditrepairsuite;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "PrintPlugin")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void generateLetterPDF(PluginCall call) {
        String htmlContent = call.getString("html");
        String fileName = call.getString("fileName", "dispute_letter.pdf");

        if (htmlContent == null || htmlContent.isEmpty()) {
            call.reject("Missing html content");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = new WebView(getContext());
                webView.getSettings().setJavaScriptEnabled(false);
                webView.getSettings().setAllowFileAccess(false);

                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager printManager =
                            (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);

                        PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                            .setResolution(new PrintAttributes.Resolution("300dpi", "300dpi", 300, 300))
                            .setMinMargins(new PrintAttributes.Margins(
                                1000, 1000, 1000, 1000  // 1 inch = 1000 mils
                            ))
                            .build();

                        PrintDocumentAdapter adapter =
                            view.createPrintDocumentAdapter(fileName);

                        printManager.print(fileName, adapter, attrs);

                        JSObject result = new JSObject();
                        result.put("success", true);
                        result.put("message", "Print dialog opened");
                        call.resolve(result);
                    }
                });

                webView.loadDataWithBaseURL(
                    null,
                    htmlContent,
                    "text/html",
                    "UTF-8",
                    null
                );

            } catch (Exception e) {
                call.reject("Failed to generate PDF: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sharePDF(PluginCall call) {
        try {
            String filePath = call.getString("filePath");
            String title = call.getString("title", "Dispute Letter");

            if (filePath == null) {
                call.reject("Missing filePath");
                return;
            }

            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File not found: " + filePath);
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("application/pdf");
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getActivity().startActivity(
                Intent.createChooser(shareIntent, "Share " + title)
            );

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to share PDF: " + e.getMessage());
        }
    }
}
