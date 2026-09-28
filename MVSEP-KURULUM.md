# Ücretsiz MVSEP ile ses ayırma

1. [MVSEP](https://mvsep.com/en/) sitesinde ücretsiz hesap açın ve giriş yapın.
2. [API belgeleri](https://mvsep.com/en/full_api) sayfasının üstünde kendi API anahtarınızı görüntüleyin.
3. Vercel projesinde **Settings → Environment Variables** bölümüne `MVSEP_API_KEY` adıyla anahtarı ekleyin. Anahtarı GitHub'a veya sohbete yazmayın. Production ortamını seçin.
4. Projeyi yeniden dağıtın. Editörde video yüklediğinizde ses ayırma otomatik başlar; aynı video için tekrar tekrar iş açılmaz.

Ücretsiz kayıtlı planın sınırı MVSEP'e göre 10 dakikalık / 100 MB dosya, günde 50 ayırma ve aynı anda tek iştir. Sıra yoğunluğunda işlem bekleyebilir. Uygulama DnR v3'ün tek SCNet modelini kullanır, konuşmayı ayırır ve müzik ile efekt dosyalarını birleştirerek sahneye kaydeder.

API anahtarı henüz eklenmediyse editördeki **Ücretsiz bulut seçeneği** alanından videoyu MVSEP sitesinde ayırıp Music ve Effects dosyalarını birlikte seçebilirsiniz. Bu yol için API anahtarı gerekmez.
