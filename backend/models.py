from sqlalchemy import Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre_usuario = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    contrasena_hash = Column(String)
    empresa = Column(String, nullable=True)
    telefono = Column(String, nullable=True)

class RegistroAuditoria(Base):
    __tablename__ = "registros_auditoria"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    accion = Column(String)
    fecha_hora = Column(DateTime, default=datetime.utcnow)

    usuario = relationship("Usuario")

class ArticuloInventario(Base):
    __tablename__ = "articulos_inventario"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), index=True)
    
    # 1. Núcleo Estándar (Indispensables)
    id_unico = Column(String, index=True) # ID del lote o fila única
    id_producto = Column(String, index=True) # ID base del producto (SKU)
    id_lote = Column(String, nullable=True, index=True) # ID de lote específico
    nombre_producto = Column(String) # Nombre del producto
    cantidad_stock = Column(Integer, default=0) # Stock en unidades
    fecha_vencimiento = Column(Date, nullable=True) # Fecha de vencimiento
    precio_unitario = Column(Float, default=0.0) # Precio de venta por unidad
    costo_unitario = Column(Float, default=0.0) # Costo unitario neto
    
    # 2. Inteligencia Predictiva (Predicción)
    demanda_diaria = Column(Float, default=0.0) # Unidades/Día
    tiempo_entrega = Column(Integer, default=0) # Tiempo de entrega proveedor (días)
    elasticidad = Column(Float, default=1.0) # Sensibilidad al precio (1.0 = estándar)
    
    # 3. Contexto Logístico (Sucursales)
    id_ubicacion = Column(String, nullable=True) # ID de Sucursal/Almacén
    nombre_ubicacion = Column(String, nullable=True) # Nombre de Sucursal
    latitud = Column(Float, nullable=True) # Coordenada Latitud
    longitud = Column(Float, nullable=True) # Coordenada Longitud
    
    # Metadatos Complementarios
    categoria = Column(String, nullable=True)
    punto_reorden = Column(Integer, default=0)
    valor_stock = Column(Float, default=0.0)
    rotacion_abc = Column(String, nullable=True)
    eta_dias = Column(Integer, default=0)
    fecha_datos = Column(Date, nullable=True) # Fecha de captura de datos (Snapshot)
    nombre_fuente = Column(String, nullable=True, index=True) # Archivo de origen
    proveedor = Column(String, nullable=True) # Proveedor del artículo
    marca = Column(String, nullable=True) # Marca or brand of the article
    clima = Column(String, nullable=True) # Condición climática (para planes de acción)
    descuento = Column(Float, default=0.0) # Descuento actual aplicado
    unidades_vendidas = Column(Float, default=0.0) # Histórico de ventas (unidades sold)
    unidades_pedidas = Column(Float, default=0.0) # Histórico de pedidos (units ordered)
    precio_competencia = Column(Float, default=0.0) # Precio de la competencia
    es_festivo = Column(Integer, default=0) # Indicador (0/1) de día festivo o promoción
    ultima_actualizacion = Column(DateTime, default=datetime.utcnow)

class Donacion(Base):
    __tablename__ = "donaciones"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), index=True)
    
    id_producto = Column(String, index=True)
    nombre_producto = Column(String)
    cantidad = Column(Integer)
    valor_monetario = Column(Float) # Costo total de lo donado / tratado
    tipo_accion = Column(String, default="Donación") # Donación, Merma, Venta Flash, Pack Rescate
    ahorro_estimado = Column(Float, default=0.0) # Ahorro por beneficios tributarios o recuperación de costo
    organizacion_receptora = Column(String, nullable=True)
    
    # Métricas de Impacto (Calculadas o estimadas)
    huella_carbono_evitada = Column(Float) # kg de CO2
    raciones_estimadas = Column(Float) 
    
    fecha_donacion = Column(DateTime, default=datetime.utcnow)
    nombre_fuente = Column(String, nullable=True, index=True) # Archivo de origen ligado
    comentarios = Column(String, nullable=True)
    proveedor = Column(String, nullable=True)         # Proveedor del producto donado
    nombre_ubicacion = Column(String, nullable=True)  # Sucursal de origen de la donación

    usuario = relationship("Usuario")

