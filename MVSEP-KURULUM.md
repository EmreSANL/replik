# Ücretsiz MVSEP ile ses ayırma

1. [MVSEP](https://mvsep.com/en/) sitesinde ücretsiz hesap açın ve giriş yapın.
2. [API belgeleri](https://mvsep.com/en/full_api) sayfasının üstünde kendi API anahtarınızı görüntüleyin.
3. Mevcut Replik Vercel projesinde **Settings → Build & Deployment** bölümünü açın. Eski `dist/client` **Output Directory** override anahtarını kapatın; bu klasör yalnızca statik siteyi dağıtıp `/api/splitter-ai` yolunu 404'e düşürüyordu. Projedeki `vercel.json`, Vercel için gereken framework ve build komutunu belirler.
4. **Settings → Environment Variables** bölümüne `MVSEP_API_KEY` adıyla anahtarı ekleyin. Anahtarı GitHub'a veya sohbete yazmayın. **Production** ortamını seçin. Mevcut Supabase değişkenlerini koruyun.
5. [Replik düzeltme isteğini](https://github.com/EmreSANL/replik/pull/1) inceleyip `main` dalına birleştirin. Yeni `main` dağıtımının Production'da hazır olmasını bekleyin; ayar değişiklikleri eski dağıtımlara uygulanmaz.
6. Editörde kısa bir video yükleyip ses ayırmanın sonuçlandığını deneyin; aynı video için tekrar tekrar iş açılmaz.

Ücretsiz kayıtlı planın sınırı MVSEP'e göre 10 dakikalık / 100 MB dosya, günde 50 ayırma ve aynı anda tek iştir. Sıra yoğunluğunda işlem bekleyebilir. Uygulama önce DnR v3 ile konuşmayı ayırır ve müzik ile efektleri birleştirir. Ardından BS Roformer ile bu karışımdaki şarkı vokalini ayırıp yalnızca enstrümantal sonucu sahneye kaydeder. Bu iki MVSEP işi her yeni video için bir kez açılır; aynı video ve kayıtlı eski DnR sonucu yeniden kullanılır.

Editörde video yüklendikten sonra ayırma otomatik başlar. Ayrı Music ve Effects dosyaları seçmek gerekmez. API anahtarı yoksa otomatik ayırma başlatılamaz; `MVSEP_API_KEY` yalnızca Vercel sunucu ortamında saklanmalıdır.
