# WIKIPEDIA DE PACKS Y COMBOS ESTRATÉGICOS (HU-PACKS-IA)
# Define plantillas de bundles para que la IA proponga combinaciones con sentido comercial.
# Incluye estacionalidad y múltiples opciones por categoría.

PACK_WIKI = {
    # --- CARNES Y PROTEÍNAS ---
    "PACK_PARRILLERO": {
        "nombre": "Mega Pack Parrillero",
        "componentes_clave": ["Carne", "Chorizos", "Carbón", "Sal", "Cerveza"],
        "objetivo": "Liquidar proteínas próximas a vencer cruzándolas con complementos de alta rotación.",
        "precio_sugerido": "Precio de la carne + 20% (incluyendo carbón y sal con descuento).",
        "beneficio": "Aumenta el ticket promedio y libera espacio en cámaras de frío.",
        "temporada": "Todo el año (Pico en Fiestas Patrias/Verano)"
    },
    "PACK_PROTEINA_FIT": {
        "nombre": "Combo Gym & Force",
        "componentes_clave": ["Pechuga de Pollo", "Huevos", "Atún", "Avena"],
        "objetivo": "Mover stock de proteínas blancas y cereales secos.",
        "precio_sugerido": "Descuento del 15% en el total del pack.",
        "beneficio": "Fidelización de segmento deportista.",
        "temporada": "Todo el año (Pico en Enero/Marzo)"
    },

    # --- LÁCTEOS Y DESAYUNO ---
    "PACK_DESAYUNO_FAMILIAR": {
        "nombre": "Desayuno Completo Premium",
        "componentes_clave": ["Leche", "Yogur", "Pan de Molde", "Mermelada", "Jugo"],
        "objetivo": "Salvar lácteos y panadería que vencen en <48 horas.",
        "precio_sugerido": "Descuento del 40% sobre el total del pack.",
        "beneficio": "Reducción directa de merma alimentaria crítica.",
        "temporada": "Todo el año"
    },
    "PACK_HORA_DEL_TE": {
        "nombre": "Momento Té & Dulzor",
        "componentes_clave": ["Té/Café", "Galletas", "Leche Condensada", "Queque/Muffin"],
        "objetivo": "Impulsar abarrotes dulces y lácteos de larga vida.",
        "precio_sugerido": "Precio fijo 'Hora del Té'.",
        "beneficio": "Mejora rotación de repostería.",
        "temporada": "Invierno/Otoño"
    },

    # --- FRUTAS Y VERDURAS ---
    "PACK_VERDE_SALUDABLE": {
        "nombre": "Canasta Agro-Eco",
        "componentes_clave": ["Tomates", "Lechuga", "Fruta de Estación", "Frutos Secos"],
        "objetivo": "Dar salida a vegetales con estética 'imperfecta' pero aptos para consumo.",
        "precio_sugerido": "Precio fijo por bolsa cerrada (sorpresa).",
        "beneficio": "Posicionamiento como negocio sustentable y residuo cero.",
        "temporada": "Todo el año"
    },
    "PACK_SOPA_INVIERNO": {
        "nombre": "Kit Sopa Casera",
        "componentes_clave": ["Zapallo", "Zanahoria", "Papas", "Apio", "Caldo en Cubo"],
        "objetivo": "Liquidar hortalizas de guarda.",
        "precio_sugerido": "Precio promocional por kilo de mezcla.",
        "beneficio": "Venta de productos de baja estética.",
        "temporada": "Invierno/Otoño"
    },
    "PACK_ENSALADA_VERANO": {
        "nombre": "Bowl Frescura Total",
        "componentes_clave": ["Pepino", "Tomate", "Palta", "Aceite de Oliva", "Limón"],
        "objetivo": "Impulsar ventas de vegetales de alta rotación en calor.",
        "precio_sugerido": "Pack 'Arma tu ensalada' a precio fijo.",
        "beneficio": "Alta rotación y frescura percibida.",
        "temporada": "Verano/Primavera"
    },

    # --- ABARROTES Y OTROS ---
    "PACK_NOCHE_DE_PIZZA": {
        "nombre": "Combo Pizza Master",
        "componentes_clave": ["Harina", "Salsa de Tomate", "Queso Mozzarella", "Bebida"],
        "objetivo": "Impulsar ventas de abarrotes secos (harina/salsa) usando el queso como gancho.",
        "precio_sugerido": "20% de descuento si se llevan todos los componentes.",
        "beneficio": "Venta cruzada de categorías alta y baja rotación.",
        "temporada": "Todo el año (Pico Fines de Semana)"
    },
    "PACK_PICOTEO_SOCIAL": {
        "nombre": "Tabla Express",
        "componentes_clave": ["Papas Fritas", "Ramitas", "Maní", "Bebida/Cerveza", "Salsa Dip"],
        "objetivo": "Mover snacks próximos a vencer con bebidas de alta rotación.",
        "precio_sugerido": "Descuento progresivo (mientras más llevas, menos pagas).",
        "beneficio": "Liberación rápida de volumen en pasillo de snacks.",
        "temporada": "Todo el año (Pico Viernes/Sábado)"
    },

    # --- ASEO Y CUIDADO ---
    "PACK_LIMPIEZA_PROFUNDA": {
        "nombre": "Kit Hogar Reluciente",
        "componentes_clave": ["Detergente", "Cloro", "Lavaloza", "Esponjas", "Desinfectante"],
        "objetivo": "Mover stock de aseo estancado o con cambio de formato/etiqueta.",
        "precio_sugerido": "3x2 en el ítem de menor valor.",
        "beneficio": "Venta por volumen de productos no perecederos.",
        "temporada": "Todo el año (Pico Marzo/Septiembre)"
    },
    "PACK_CUIDADO_VITAL": {
        "nombre": "Kit Bienestar y Salud",
        "componentes_clave": ["Vitaminas", "Alcohol Gel", "Mascarillas", "Jabón"],
        "objetivo": "Rotar productos de parafarmacia con baja demanda estacional.",
        "precio_sugerido": "Precio especial 'Protección Total'.",
        "beneficio": "Asegura rotación de productos con vencimientos largos pero demanda errática.",
        "temporada": "Invierno (Gripe) / Todo el año"
    },
    "PACK_BEBE_FELIZ": {
        "nombre": "Cuidado Infantil",
        "componentes_clave": ["Pañales", "Toallitas Húmedas", "Talco/Crema", "Colonia"],
        "objetivo": "Venta cruzada de productos de alta fidelidad.",
        "precio_sugerido": "Descuento en el pack completo vs compra individual.",
        "beneficio": "Fidelización de padres y rotación de accesorios.",
        "temporada": "Todo el año"
    }
}

def obtener_temporada_actual():
    """
    Simple helper para determinar temporada según mes actual.
    """
    import datetime
    mes = datetime.datetime.now().month
    if mes in [12, 1, 2]: return "Verano"
    if mes in [3, 4, 5]: return "Otoño"
    if mes in [6, 7, 8]: return "Invierno"
    return "Primavera"

def sugerir_pack(categoria_producto: str):
    """
    Retorna una lista de plantillas de packs adecuadas según la categoría del producto,
    considerando estacionalidad.
    """
    temporada = obtener_temporada_actual()
    
    mapeo = {
        "LACTEOS": ["PACK_DESAYUNO_FAMILIAR", "PACK_HORA_DEL_TE"],
        "CARNES_POLLO": ["PACK_PARRILLERO", "PACK_PROTEINA_FIT"],
        "PANADERIA_PASTELERIA": ["PACK_DESAYUNO_FAMILIAR", "PACK_HORA_DEL_TE"],
        "FRUTAS_VERDURAS_SURTIDAS": ["PACK_VERDE_SALUDABLE", "PACK_SOPA_INVIERNO", "PACK_ENSALADA_VERANO"],
        "CONSERVAS_LATAS": ["PACK_NOCHE_DE_PIZZA", "PACK_SOPA_INVIERNO"],
        "ABARROTES_SECOS": ["PACK_NOCHE_DE_PIZZA", "PACK_PROTEINA_FIT", "PACK_PICOTEO_SOCIAL"],
        "ASEO_Y_LIMPIEZA": ["PACK_LIMPIEZA_PROFUNDA"],
        "FARMACIA_BASICA": ["PACK_CUIDADO_VITAL"],
        "CUIDADO_PERSONAL": ["PACK_BEBE_FELIZ", "PACK_CUIDADO_VITAL"]
    }
    
    opciones_keys = mapeo.get(categoria_producto, [])
    if not opciones_keys:
        return []
        
    packs_finales = []
    for k in opciones_keys:
        p = PACK_WIKI.get(k)
        if not p: continue
        
        temp_pack = p.get("temporada", "Todo el año")
        if temporada in temp_pack or "Todo el año" in temp_pack:
            packs_finales.append(p)
            
    return packs_finales[:3]  # Limitar a 3 mejores opciones
