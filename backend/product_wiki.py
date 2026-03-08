# WIKIPEDIA DE PRODUCTOS Y SEGURIDAD ALIMENTARIA (HU-INTELIGENCIA-IA)
# Este archivo sirve como base de conocimiento experto para la IA de Antigravity.
# Incluye márgenes de seguridad, indicadores de deterioro y acciones recomendadas.

PRODUCT_WIKI = {
    "LACTEOS": {
        "productos": ["Leche", "Yogur", "Queso Fresco", "Crema", "Mantequilla"],
        "extension_seguridad_dias": 3,
        "indicadores_peligro": "Olor agrio, separación de líquidos (suero), moho visible, cambio de color a amarillento/verdoso.",
        "riesgo_humano": "ALTO (Riesgo de intoxicación por bacterias como Listeria o Salmonella).",
        "accion_post_vencimiento": "ELIMINAR / DESTRUIR (No donar después de fecha de vencimiento).",
        "estrategia_preventiva": "Descuento agresivo (50%+) 2 días antes del vencimiento. Mover al frente de la góndola."
    },
    "CARNES_POLLO": {
        "productos": ["Pollo", "Carne Vacuno", "Carne Cerdo", "Carne Molida"],
        "extension_seguridad_dias": 0,
        "indicadores_peligro": "Superficie pegajosa o lamosa, olor a amoníaco o rancio, color grisáceo o verdoso.",
        "riesgo_humano": "MUY ALTO (Peligro de muerte/hospitalización).",
        "accion_post_vencimiento": "ELIMINAR INMEDIATAMENTE (Prohibido donar o re-etiquetar).",
        "estrategia_preventiva": "Liquidación total 1 día antes. Donación exclusiva a plantas de procesamiento de alimento para mascotas si aplica."
    },
    "PANADERIA_PASTELERIA": {
        "productos": ["Pan Molde", "Masas Dulces", "Tortas con Crema", "Galletas Frescas"],
        "extension_seguridad_dias": 2,
        "indicadores_peligro": "Moho (puntos blancos/azules/negros), olor a alcohol o fermentado (en masas), textura excesivamente seca o chiclosa.",
        "riesgo_humano": "MEDIO (El moho produce micotoxinas que son tóxicas a largo plazo).",
        "accion_post_vencimiento": "ELIMINAR (Si hay moho). Si solo está seco, se puede donar para consumo animal.",
        "estrategia_preventiva": "Venta en 'Packs Sorpresa' (tipo Too Good To Go) al final del día. Descuento por volumen."
    },
    "FRUTAS_VERDURAS_SURTIDAS": {
        "productos": ["Tomates", "Lechugas", "Frutas de Estación", "Hortalizas"],
        "extension_seguridad_dias": 5,
        "indicadores_peligro": "Puntos de pudrición blandos, moho, olor a fermento, marchitamiento extremo.",
        "riesgo_humano": "BAJO/MEDIO.",
        "accion_post_vencimiento": "DONAR (Si la estética es mala pero sigue apto). COMPOST/DESECHO (Si hay pudrición).",
        "estrategia_preventiva": "Packs 'Segunda Vida' (kits para jugos o guisos). Mover a zona de oferta rápida."
    },
    "ABARROTES_SECOS": {
        "productos": ["Arroz", "Pastas", "Harinas", "Legumbres Secas", "Azúcar", "Sal"],
        "extension_seguridad_dias": 180,
        "indicadores_peligro": "Presencia de gorgojos o larvas, humedad o grumos (indica filtración), olor rancio (en harinas integrales).",
        "riesgo_humano": "BAJO (Principalmente pérdida de calidad sensorial).",
        "accion_post_vencimiento": "DONAR (Apto para consumo social hasta 6 meses después si el empaque está íntegro).",
        "estrategia_preventiva": "Primeras en entrar, primeras en salir (FIFO). Packs combo con productos frescos."
    },
    "CONSERVAS_LATAS": {
        "productos": ["Atún en lata", "Legumbres cocidas", "Salsas de tomate en tarro"],
        "extension_seguridad_dias": 365,
        "indicadores_peligro": "Lata hinchada (botulismo), lata abollada en juntas, óxido en costuras.",
        "riesgo_humano": "MUY ALTO (Botulismo si hay hinchazón). Si la lata está íntegra, el riesgo es nulo.",
        "accion_post_vencimiento": "DONAR (Siempre que el envase esté perfecto). ELIMINAR (Si hay golpes o abombamiento).",
        "estrategia_preventiva": "Rotación de góndola. Venta flash por cambio de temporada de etiquetas."
    },
    "BEBIDAS_Y_LIQUIDOS": {
        "productos": ["Jugos en caja", "Bebidas Gaseosas", "Cerveza", "Agua Mineral"],
        "extension_seguridad_dias": 60,
        "indicadores_peligro": "Cambio drástico de color, sedimento inusual (no natural), pérdida total de gas.",
        "riesgo_humano": "BAJO (Pérdida de sabor y gas).",
        "accion_post_vencimiento": "LIQUIDAR / DONAR (Si no hay fermentación visible).",
        "estrategia_preventiva": "Promoción 3x2. Cross-selling con snacks."
    },
    "ASEO_Y_LIMPIEZA": {
        "productos": ["Cloro", "Detergente", "Lavaloza", "Desinfectantes"],
        "extension_seguridad_dias": 730,
        "indicadores_peligro": "Separación de fases (líquido se ve cortado), pérdida de fragancia, cristalización.",
        "riesgo_humano": "NULO (No comestible). Riesgo de pérdida de efectividad química.",
        "accion_post_vencimiento": "DONAR A INSTITUCIONES (Sigue sirviendo para limpieza gruesa).",
        "estrategia_preventiva": "Visibilizar en puntas de góndola. Venta en packs hogar."
    },
    "ELECTRONICA": {
        "productos": ["Baterías", "Cargadores", "Audífonos", "Smartphones"],
        "extension_seguridad_dias": 730,
        "indicadores_peligro": "Hinchazón de batería (muy peligroso), sulfatación (polvo blanco), sobrecalentamiento al cargar.",
        "riesgo_humano": "ALTO (Riesgo de incendio o explosión).",
        "accion_post_vencimiento": "RECICLAJE TÉCNICO (No tirar a la basura común).",
        "estrategia_preventiva": "Venta en 'Outlet Tecnológico'. Descuento por renovación de stock."
    },
    "CUIDADO_PERSONAL": {
        "productos": ["Cremas Faciales", "Bloqueador Solar", "Perfumes", "Maquillaje"],
        "extension_seguridad_dias": 180,
        "indicadores_peligro": "Separación de aceite, olor rancio, cambio de color, irritación al contacto.",
        "riesgo_humano": "MEDIO (Dermatitis o reacciones alérgicas).",
        "accion_post_vencimiento": "ELIMINAR (Si hay cambio de olor/textura). DONAR (Solo si está sellado y con <3 meses de vencido).",
        "estrategia_preventiva": "Muestras gratis con compras grandes. Sets de regalo con descuento."
    },
    "FARMACIA_BASICA": {
        "productos": ["Paracetamol", "Ibuprofeno", "Vitaminas", "Gasas", "Alcohol Gel"],
        "extension_seguridad_dias": 0,
        "indicadores_peligro": "Tabletas que se desboronan, cambio de color en cápsulas, turbiedad en líquidos.",
        "riesgo_humano": "MUY ALTO (Pérdida de eficacia o toxicidad química).",
        "accion_post_vencimiento": "DESTRUCCIÓN CONTROLADA (Puntos de recogida de fármacos).",
        "estrategia_preventiva": "Alertas de vencimiento 6 meses antes. Retorno a proveedor según contrato."
    }
}

# Diccionario de palabras clave para mapeo rápido de productos desconocidos a categorías de la wiki
KEYWORDS_CATEGORIES = {
    "leche": "LACTEOS", "yogur": "LACTEOS", "queso": "LACTEOS", "crema": "LACTEOS",
    "pollo": "CARNES_POLLO", "vacuno": "CARNES_POLLO", "cerdo": "CARNES_POLLO", "carne": "CARNES_POLLO",
    "pan": "PANADERIA_PASTELERIA", "torta": "PANADERIA_PASTELERIA", "galleta": "PANADERIA_PASTELERIA",
    "tomate": "FRUTAS_VERDURAS_SURTIDAS", "fruta": "FRUTAS_VERDURAS_SURTIDAS", "verdura": "FRUTAS_VERDURAS_SURTIDAS",
    "arroz": "ABARROTES_SECOS", "pasta": "ABARROTES_SECOS", "fideo": "ABARROTES_SECOS", "harina": "ABARROTES_SECOS",
    "atun": "CONSERVAS_LATAS", "salsa": "CONSERVAS_LATAS", "lata": "CONSERVAS_LATAS",
    "jugo": "BEBIDAS_Y_LIQUIDOS", "bebida": "BEBIDAS_Y_LIQUIDOS", "cerveza": "BEBIDAS_Y_LIQUIDOS",
    "cloro": "ASEO_Y_LIMPIEZA", "detergente": "ASEO_Y_LIMPIEZA", "limpia": "ASEO_Y_LIMPIEZA",
    "bateria": "ELECTRONICA", "pila": "ELECTRONICA", "celular": "ELECTRONICA",
    "bloqueador": "CUIDADO_PERSONAL", "crema": "CUIDADO_PERSONAL", "perfume": "CUIDADO_PERSONAL",
    "paracetamol": "FARMACIA_BASICA", "vitamina": "FARMACIA_BASICA", "alcohol": "FARMACIA_BASICA"
}

def obtener_info_experta(nombre_producto: str):
    """
    Busca en la wiki la información de seguridad para un producto dado.
    """
    nombre_lower = nombre_producto.lower()
    categoria_hallada = "OTRO"
    
    for key, cat in KEYWORDS_CATEGORIES.items():
        if key in nombre_lower:
            categoria_hallada = cat
            break
            
    return PRODUCT_WIKI.get(categoria_hallada, {
        "extension_seguridad_dias": 0,
        "indicadores_peligro": "Consultar etiqueta del fabricante. Si hay olor/color raro, descartar.",
        "riesgo_humano": "DESCONOCIDO (Tratar como ALTO por seguridad).",
        "accion_post_vencimiento": "ELIMINAR SI HAY DUDA.",
        "estrategia_preventiva": "Descuento preventivo x 30 días."
    }), categoria_hallada
