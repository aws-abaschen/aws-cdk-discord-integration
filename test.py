from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

# Your public key can be found on your application in the Developer Portal
PUBLIC_KEY = 'c1849d7c1f6cae0c964f46d7616e9efbc2ec71c39e7f3223d9935b6c9f27ed1b'
signature = "147e54c48862ce869d6a1f4988afdefa414956455b8f1f980bd2a38cef8329766e77cc7ce4b01acb72ebe33f6e108e5c6fed57ce7a393353b98e80ee0dc8f105"
timestamp = "1732554476"

#PUBLIC_KEY = '6c59167711347c488ccecb406667a71939cbe39a592095ba9ef7eb263325048b'
#signature= '680804a4ce6bbfe5bcab0278274c4a7fe88aa5624753f47f08be4dbfc0d78e99079b962d16bdf902626a7c052359fede7c19a4c900e6127ad1669b21f9afc001'
body= '{"app_permissions":"562949953601536","application_id":"1310653110762606692","authorizing_integration_owners":{},"entitlements":[],"id":"1310653205050429550","token":"aW50ZXJhY3Rpb246MTMxMDY1MzIwNTA1MDQyOTU1MDpWQTNnSjVWYTB0OVFvQ2RzZzByejdraUMwSFREeXZXM0tNc2VaVEVhMmxFWkxZcUtYMkNzb1RVTGVvRVVjWm5vUzI1dFR5M2VXWUxncjNlOW1vRDYyS0hrbEltSWlLNDhsVWpGTUxpRzdRMVpXc2h2NzR1R2Q0TW1hN080em80Vg","type":1,"user":{"avatar":"c6a249645d46209f337279cd2ca998c7","avatar_decoration_data":null,"bot":true,"clan":null,"discriminator":"0000","global_name":"Discord","id":"643945264868098049","primary_guild":null,"public_flags":1,"system":true,"username":"discord"},"version":1}'
 
verify_key = VerifyKey(bytes.fromhex(PUBLIC_KEY))


try:
    verify_key.verify(f'{timestamp}{body}'.encode(), bytes.fromhex(signature))
    print('OK')
except BadSignatureError:
    print('invalid request signature')
